use tauri::{LogicalPosition, LogicalSize, Manager, Webview, WebviewUrl};

const LABEL: &str = "lolalytics";

// Async commands avoid blocking the UI thread while add_child creates its view.
#[tauri::command]
pub async fn update_lolalytics_view(
    webview: Webview,
    url: Option<String>,
    visible: bool,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if webview.label() != "main" {
        return Err("Only the main view can control Lolalytics".into());
    }
    let url = url
        .map(|value| {
            let parsed = tauri::Url::parse(&value).map_err(|err| err.to_string())?;
            if parsed.scheme() != "https" || parsed.host_str() != Some("lolalytics.com") {
                return Err("Invalid Lolalytics URL".to_string());
            }
            Ok(parsed)
        })
        .transpose()?;
    let position = LogicalPosition::new(x, y);
    let size = LogicalSize::new(width, height);
    let child = if let Some(child) = webview.app_handle().get_webview(LABEL) {
        if let Some(url) = url {
            child.navigate(url).map_err(|err| err.to_string())?;
        }
        // Preserve the page's layout and scroll position while its tab is hidden.
        if visible {
            child
                .set_bounds(tauri::Rect {
                    position: position.into(),
                    size: size.into(),
                })
                .map_err(|err| err.to_string())?;
        }
        child
    } else if let Some(url) = url {
        webview
            .window()
            .add_child(
                tauri::webview::WebviewBuilder::new(LABEL, WebviewUrl::External(url)),
                position,
                size,
            )
            .map_err(|err| err.to_string())?
    } else {
        return Ok(());
    };
    if visible { child.show() } else { child.hide() }.map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn close_lolalytics_view(webview: Webview) -> Result<(), String> {
    if webview.label() != "main" {
        return Err("Only the main view can control Lolalytics".into());
    }
    if let Some(child) = webview.app_handle().get_webview(LABEL) {
        child.close().map_err(|err| err.to_string())?;
    }
    Ok(())
}
