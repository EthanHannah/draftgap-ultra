use reqwest::{redirect::Policy, Client};
use serde::Deserialize;
use std::time::Duration;
use tauri::{State, Webview};

pub struct BuildClient(Client);

impl BuildClient {
    pub fn new() -> Result<Self, reqwest::Error> {
        // Do not reuse the LCU client: it accepts League's self-signed certificate.
        Client::builder()
            .timeout(Duration::from_secs(25))
            .redirect(Policy::none())
            .user_agent("DraftGap/4.4 (desktop build analysis)")
            .build()
            .map(Self)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BuildRequest {
    patch: String,
    champion_id: String,
    role: String,
    matchup_id: Option<String>,
    matchup_role: Option<String>,
    keystone: Option<u32>,
}

fn champion_slug(id: &str) -> Result<String, String> {
    if id.is_empty() || id.len() > 40 || !id.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return Err("Invalid champion ID".into());
    }
    let slug = id.to_ascii_lowercase();
    Ok(if slug == "monkeyking" {
        "wukong".into()
    } else {
        slug
    })
}

fn valid_role(role: &str) -> bool {
    matches!(role, "top" | "jungle" | "middle" | "bottom" | "support")
}

fn build_url(request: &BuildRequest) -> Result<tauri::Url, String> {
    let patch_parts: Vec<_> = request.patch.split('.').collect();
    if request.patch != "30"
        && !(patch_parts.len() == 2
            && patch_parts.iter().all(|part| {
                !part.is_empty() && part.len() <= 2 && part.bytes().all(|b| b.is_ascii_digit())
            }))
    {
        return Err("Invalid build patch".into());
    }
    if !valid_role(&request.role) {
        return Err("Invalid build role".into());
    }
    if let Some(keystone) = request.keystone {
        if !(1000..=99999).contains(&keystone) || request.matchup_id.is_some() {
            return Err("Invalid keystone filter".into());
        }
    }
    let champion = champion_slug(&request.champion_id)?;
    let matchup = match (&request.matchup_id, &request.matchup_role) {
        (Some(id), Some(role)) if valid_role(role) => format!("vs/{}/", champion_slug(id)?),
        (None, None) => String::new(),
        _ => return Err("Invalid matchup".into()),
    };
    let mut url = tauri::Url::parse(&format!(
        "https://lolalytics.com/lol/{champion}/{matchup}build/"
    ))
    .map_err(|err| err.to_string())?;
    url.query_pairs_mut()
        .append_pair("patch", &request.patch)
        .append_pair("lane", &request.role)
        .append_pair("tier", "emerald_plus");
    // Worldwide is the default. Explicit region=all currently breaks matchup pages.
    if let Some(role) = &request.matchup_role {
        url.query_pairs_mut().append_pair("vslane", role);
    }
    if let Some(keystone) = request.keystone {
        url.query_pairs_mut()
            .append_pair("keystone", &keystone.to_string());
    }
    Ok(url)
}

#[tauri::command]
pub async fn fetch_lolalytics_build(
    webview: Webview,
    client: State<'_, BuildClient>,
    request: BuildRequest,
) -> Result<String, String> {
    if webview.label() != "main" {
        return Err("Only the main view can fetch builds".into());
    }
    let url = build_url(&request)?;
    fetch_url(&client, url).await
}

fn item_sets_url(request: &BuildRequest) -> Result<tauri::Url, String> {
    build_url(request)?; // Reuse champion, role, and patch validation.
    if request.matchup_id.is_some() || request.matchup_role.is_some() || request.keystone.is_some()
    {
        return Err("Purchase-order data only supports baseline builds".into());
    }
    let mut url =
        tauri::Url::parse("https://a1.lolalytics.com/mega/").map_err(|err| err.to_string())?;
    url.query_pairs_mut()
        .append_pair("ep", "build-itemset")
        .append_pair("v", "1")
        .append_pair("patch", &request.patch)
        .append_pair("c", &champion_slug(&request.champion_id)?)
        .append_pair("lane", &request.role)
        .append_pair("tier", "emerald_plus")
        .append_pair("queue", "ranked")
        .append_pair("region", "all");
    Ok(url)
}

#[tauri::command]
pub async fn fetch_lolalytics_item_sets(
    webview: Webview,
    client: State<'_, BuildClient>,
    request: BuildRequest,
) -> Result<String, String> {
    if webview.label() != "main" {
        return Err("Only the main view can fetch builds".into());
    }
    fetch_url(&client, item_sets_url(&request)?).await
}

async fn fetch_url(client: &BuildClient, url: tauri::Url) -> Result<String, String> {
    let mut response = client.0.get(url).send().await.map_err(|_| {
        "Could not reach Lolalytics. Check your connection and try again.".to_string()
    })?;
    if !response.status().is_success() {
        return Err(format!(
            "Lolalytics returned HTTP {}. Build data may be temporarily unavailable.",
            response.status().as_u16()
        ));
    }
    const MAX_BYTES: usize = 8 * 1024 * 1024;
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Could not read Lolalytics build data".to_string())?
    {
        if body.len() + chunk.len() > MAX_BYTES {
            return Err("Lolalytics build response is too large".into());
        }
        body.extend_from_slice(&chunk);
    }
    String::from_utf8(body).map_err(|_| "Lolalytics returned invalid text".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> BuildRequest {
        BuildRequest {
            patch: "30".into(),
            champion_id: "Ahri".into(),
            role: "middle".into(),
            matchup_id: None,
            matchup_role: None,
            keystone: None,
        }
    }

    #[test]
    fn restricts_urls_and_normalizes_matchups() {
        let mut r = request();
        r.matchup_id = Some("MonkeyKing".into());
        r.matchup_role = Some("jungle".into());
        let url = build_url(&r).unwrap();
        assert_eq!(url.host_str(), Some("lolalytics.com"));
        assert_eq!(url.path(), "/lol/ahri/vs/wukong/build/");
        assert!(!url.as_str().contains("region="));
        assert!(url.as_str().contains("vslane=jungle"));
        for id in ["../admin", "https://example.com", "ahri?x=y", ""] {
            r.champion_id = id.into();
            assert!(build_url(&r).is_err());
        }
    }

    #[test]
    fn validates_patch_role_and_matchup_pairs() {
        for patch in ["", "30&region=all", "16.17.1", "../../", "all"] {
            let mut r = request();
            r.patch = patch.into();
            assert!(build_url(&r).is_err());
        }
        let mut r = request();
        r.patch = "16.17".into();
        assert!(build_url(&r).is_ok());
        r.role = "invalid".into();
        assert!(build_url(&r).is_err());
        let mut r = request();
        r.matchup_id = Some("Zed".into());
        assert!(build_url(&r).is_err());
    }

    #[test]
    fn restricts_item_set_requests() {
        let mut r = request();
        r.champion_id = "MonkeyKing".into();
        let url = item_sets_url(&r).unwrap();
        assert_eq!(url.host_str(), Some("a1.lolalytics.com"));
        assert!(url.as_str().contains("ep=build-itemset"));
        assert!(url.as_str().contains("c=wukong"));
        r.champion_id = "https://example.com".into();
        assert!(item_sets_url(&r).is_err());
        let mut r = request();
        r.matchup_id = Some("Zed".into());
        r.matchup_role = Some("middle".into());
        assert!(item_sets_url(&r).is_err());
    }

    #[test]
    fn validates_keystone_filters() {
        let mut r = request();
        r.keystone = Some(9923);
        assert!(build_url(&r).unwrap().as_str().contains("keystone=9923"));
        assert!(item_sets_url(&r).is_err());
        r.keystone = Some(0);
        assert!(build_url(&r).is_err());
        r.keystone = Some(100000);
        assert!(build_url(&r).is_err());
    }
}
