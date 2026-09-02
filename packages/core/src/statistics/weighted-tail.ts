type WeightedValue = { rating: number; weight: number };

// Computes the weighted lower tail without sorting the whole distribution.
// The caller owns the array: partitioning deliberately rearranges it in place.
// Weights must be positive, and targetWeight must be in (0, total weight].
export function weightedLowerTailSum(
    rows: WeightedValue[],
    targetWeight: number,
) {
    let left = 0;
    let right = rows.length - 1;
    let remainingWeight = targetWeight;
    let sum = 0;

    while (left <= right && remainingWeight > 0) {
        const first = rows[left]!.rating;
        const middle = rows[(left + right) >>> 1]!.rating;
        const last = rows[right]!.rating;
        const pivot = Math.max(
            Math.min(first, middle),
            Math.min(Math.max(first, middle), last),
        );
        let lower = left;
        let upper = right;
        let index = left;
        let lowerWeight = 0;
        let lowerSum = 0;
        let equalWeight = 0;

        // Three-way partition handles the many identical prior nodes quickly.
        while (index <= upper) {
            const row = rows[index]!;
            if (row.rating < pivot) {
                lowerWeight += row.weight;
                lowerSum += row.rating * row.weight;
                rows[index] = rows[lower]!;
                rows[lower++] = row;
                index++;
            } else if (row.rating > pivot) {
                rows[index] = rows[upper]!;
                rows[upper--] = row;
            } else {
                equalWeight += row.weight;
                index++;
            }
        }

        if (remainingWeight < lowerWeight) {
            right = lower - 1;
            continue;
        }
        sum += lowerSum;
        remainingWeight -= lowerWeight;
        const includedWeight = Math.min(remainingWeight, equalWeight);
        sum += pivot * includedWeight;
        remainingWeight -= includedWeight;
        left = upper + 1;
    }
    return sum;
}
