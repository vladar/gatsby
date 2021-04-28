# Filters benchmark

## Methodology

Using custom benchmarks site [query-filters-sort](https://github.com/vladar/gatsby/tree/vladar/standalone-api/benchmarks/query-filters-sort).
Running 1000 queries against varying number of nodes (from 1,000 to 1,000,000).

Results are sorted by random int value assigned to each node.

Using time reported by CLI. Also capturing memory details right after
page queries:

In `commands/build.js`:

```js
await (0, _services.runPageQueries)({
  queryIds,
  graphqlRunner,
  parentSpan: buildSpan,
  store: _redux.store,
})

global.gc()
await new Promise(resolve => setTimeout(resolve, 5000))
console.log(ptop.toString())
process.exit(0)
```

## Filter `eq`:

### Speed

| Nodes          | page queries, latest | page queries, lmdb | indexing (latest) | indexing (lmdb), MB |
| -------------- | -------------------- | ------------------ | ----------------- | ------------------- |
| 1000 (small)   | 1.8s                 | 1.787s             | 2ms               | 16ms                |
| 1000 (big)     | 1.8s                 | 2s                 | 2ms               | 43ms                |
| 10000 (small)  | 1.9s                 | 2.33s              | 16ms              | 190ms               |
| 10000 (big)    | 1.76s                | 2.45s              | 16ms              | 583ms               |
| 100000 (small) | 1.8s                 | 5.3s               | 138ms             | 3s                  |
| 100000 (big)   | 1.8s                 | 6.45s              | 152ms             | 4.2s                |

### Memory

| Nodes          | rss peak, MB (latest) | rss peak, MB (lmdb) | heap total, MB (latest) | heap total, MB (lmdb) |
| -------------- | --------------------- | ------------------- | ----------------------- | --------------------- |
| 1000 (small)   | 204                   | 209                 | 138                     | 140                   |
| 1000 (big)     | 204                   | 217                 | 139                     | 142                   |
| 10000 (small)  | 210                   | 239                 | 147                     | 153                   |
| 10000 (big)    | 255                   | 395                 | 189                     | 190                   |
| 100000 (small) | 429                   | 557                 | 226                     | 308                   |
| 100000 (big)   | 782                   | 1602                | 709                     | 496                   |

## Filter `in` (no sort)

### Speed

| Nodes          | page queries, latest | page queries, lmdb | indexing (latest) | indexing (lmdb), MB |
| -------------- | -------------------- | ------------------ | ----------------- | ------------------- |
| 1000 (small)   | 2.4s                 | 1.9s               | 2ms               | 15ms                |
| 1000 (big)     | 2.6s                 | 2.2s               | 2ms               | 44ms                |
| 10000 (small)  | 11.6s                | 2.5s               | 20ms              | 193ms               |
| 10000 (big)    | 12.3s                | 2.75               | 20ms              | 570ms               |
| 100000 (small) | 88.8s                | 7.5s               | 65ms              | 3s                  |
| 100000 (big)   | 125s                 | 8.5s               | 85ms              | 4.1s                |

### Memory

| Nodes          | rss peak, MB (latest) | rss peak, MB (lmdb) | heap total, MB (latest) | heap total, MB (lmdb) |
| -------------- | --------------------- | ------------------- | ----------------------- | --------------------- |
| 1000 (small)   | 201                   | 209                 | 139                     | 140                   |
| 1000 (big)     | 209                   | 219                 | 147                     | 144                   |
| 10000 (small)  | 212                   | 237                 | 149                     | 151                   |
| 10000 (big)    | 279                   | 400                 | 218                     | 200                   |
| 100000 (small) | 673                   | 549                 | 233                     | 311                   |
| 100000 (big)   | 900                   | 1792                | 739                     | 479                   |

## Filter `in` (with sort)

### Speed

| Nodes          | page queries, latest | page queries, lmdb | indexing (latest) | indexing (lmdb), MB |
| -------------- | -------------------- | ------------------ | ----------------- | ------------------- |
| 1000 (small)   | 3.1s                 | 1.9s               | 2ms               | 12ms                |
| 1000 (big)     | 3.5s                 | 2.13s              | 2ms               | 40ms                |
| 10000 (small)  | 19.6s                | 2.3s               | 20ms              | 192ms               |
| 10000 (big)    | 21s                  | 2.6s               | 17ms              | 561ms               |
| 100000 (small) | 236s                 | 5.5s               | 71ms              | 3s                  |
| 100000 (big)   | 306s                 | 6.4s               | 82ms              | 4s                  |

### Memory

| Nodes          | rss peak, MB (latest) | rss peak, MB (lmdb) | heap total, MB (latest) | heap total, MB (lmdb) |
| -------------- | --------------------- | ------------------- | ----------------------- | --------------------- |
| 1000 (small)   | 205                   | 210                 | 140                     | 141                   |
| 1000 (big)     | 208                   | 219                 | 147                     | 143                   |
| 10000 (small)  | 210                   | 240                 | 147                     | 153                   |
| 10000 (big)    | 277                   | 385                 | 214                     | 193                   |
| 100000 (small) | 746                   | 596                 | 308                     | 304                   |
| 100000 (big)   | 1001                  | 1797                | 820                     | 480                   |

## Filter `gt` (no sort)

### Speed

| Nodes          | page queries, latest | page queries, lmdb | indexing (latest) | indexing (lmdb), MB |
| -------------- | -------------------- | ------------------ | ----------------- | ------------------- |
| 1000 (small)   | 1.8s                 | 1.75s              | 4ms               | 15ms                |
| 1000 (big)     | 2.2s                 | 2.1s               | 5ms               | 45ms                |
| 10000 (small)  | 6.4s                 | 2.75s              | 46ms              | 180ms               |
| 10000 (big)    | 6.7s                 | 3.3s               | 47ms              | 578ms               |
| 100000 (small) | 37s                  | 8.6s               | 262ms             | 3s                  |
| 100000 (big)   | 48.7s                | 14s                | 255ms             | 4.2s                |

### Memory

| Nodes          | rss peak, MB (latest) | rss peak, MB (lmdb) | heap total, MB (latest) | heap total, MB (lmdb) |
| -------------- | --------------------- | ------------------- | ----------------------- | --------------------- |
| 1000 (small)   | 201                   | 211                 | 139                     | 141                   |
| 1000 (big)     | 210                   | 219                 | 148                     | 144                   |
| 10000 (small)  | 213                   | 237                 | 152                     | 153                   |
| 10000 (big)    | 280                   | 400                 | 219                     | 202                   |
| 100000 (small) | 432                   | 682                 | 277                     | 337                   |
| 100000 (big)   | 923                   | 2160                | 736                     | 615                   |

## Filter `gt` (with sort)

### Speed

| Nodes          | page queries, latest | page queries, lmdb | indexing (latest) | indexing (lmdb), MB |
| -------------- | -------------------- | ------------------ | ----------------- | ------------------- |
| 1000 (small)   | 2.8s                 | 2.3s               | 4ms               | 14ms                |
| 1000 (big)     | 2.8s                 | 2.1s               | 4ms               | 42ms                |
| 10000 (small)  | 22.3s                | 2.9s               | 49ms              | 188ms               |
| 10000 (big)    | 21.5s                | 3.3                | 46ms              | 572ms               |
| 100000 (small) | 401s                 | 8.7s               | 263ms             | 3s                  |
| 100000 (big)   | 423s                 | 14s                | 248ms             | 4.2s                |

### Memory

| Nodes          | rss peak, MB (latest) | rss peak, MB (lmdb) | heap total, MB (latest) | heap total, MB (lmdb) |
| -------------- | --------------------- | ------------------- | ----------------------- | --------------------- |
| 1000 (small)   | 201                   | 208                 | 139                     | 141                   |
| 1000 (big)     | 208                   | 218                 | 145                     | 144                   |
| 10000 (small)  | 216                   | 238                 | 154                     | 153                   |
| 10000 (big)    | 268                   | 405                 | 191                     | 206                   |
| 100000 (small) | 942                   | 684                 | 505                     | 343                   |
| 100000 (big)   | 1320                  | 2250                | 822                     | 619                   |
