# LMDB queries benchmark

## Methodology

Using custom benchmarks site for this test. Each query has multiple
filters (including one range filter).

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

## Machine

Ran all tests on Linode VPS with 8 dedicated CPUs (2200 Mhz) and 16 GB of RAM.

## Test 1. Small nodes + filter by `id`

Create from 1000 to 100,000 small nodes and a page for each of them. Then query with:

```graphql
query($id: String!) {
  test(stepStr: { eq: $id }) {
    step
    text
  }
}
```

This query essentially bypasses our fast filters (indexes) and goes directly to store.

### Latest `gatsby@3.3.0` (no LMDB):

| Pages   | page queries      | rss, MB | rss peak, MB | heap used, MB | heap total, MB | ext, MB |
| ------- | ----------------- | ------- | ------------ | ------------- | -------------- | ------- |
| 1000    | 0.9s (1109 q/s)   | 204     | 210          | 91            | 143            | 140     |
| 10,000  | 5.847s (1710 q/s) | 319     | 347          | 122           | 257            | 140     |
| 50,000  | 27.6s (1811 q/s)  | 539     | 710          | 251           | 472            | 140     |
| 100,000 | 65.35s (1530 q/s) | 836     | 1170         | 423           | 760            | 140     |
| 500,000 | 657 (760 q/s)     | 3500    | 4049         | 1700          | 3300           | 140     |

### Gatsby+LMDB:

| Pages   | page queries      | rss, MB | rss peak, MB | heap used, MB | heap total, MB | ext, MB |
| ------- | ----------------- | ------- | ------------ | ------------- | -------------- | ------- |
| 1000    | 0.9s (1114 q/s)   | 210     | 210          | 91            | 144            | 140     |
| 10,000  | 5.74s (1740 q/s)  | 255     | 413          | 111           | 255            | 140     |
| 50,000  | 27.61s (1810 q/s) | 868     | 913          | 210           | 507            | 140     |
| 100,000 | 65.35s (1530 q/s) | 1500    | 1670         | 315           | 758            | 140     |
| 500,000 | 607.3s (823 q/s)  | 5400    | 8124         | 1200          | 2100           | 140     |

## Test2. Nodes with 40kb of text each + filter by `id`

Same test as Test 1. Just `text` field in the query is now `40kb`:

```graphql
query($id: String!) {
  test(stepStr: { eq: $id }) {
    step
    text
  }
}
```

### Latest `gatsby@3.3.0` (no LMDB):

| Pages   | page queries      | rss, MB | rss peak, MB | heap used, MB | heap total, MB | ext, MB |
| ------- | ----------------- | ------- | ------------ | ------------- | -------------- | ------- |
| 1000    | 1.35s (738 q/s)   | 250     | 274          | 130           | 190            | 142     |
| 10,000  | 10.35s (978 q/s)  | 697     | 727          | 524           | 649            | 142     |
| 50,000  | 50.83s (983 q/s)  | 2600    | 2678         | 2300          | 2600           | 142     |
| 100,000 | 120.35s (833 q/s) | 5000    | 5119         | 4400          | 5100           | 142     |

### Gatsby+LMDB:

| Pages   | page queries      | rss, MB | rss peak, MB | heap used, MB | heap total, MB | ext, MB |
| ------- | ----------------- | ------- | ------------ | ------------- | -------------- | ------- |
| 1000    | 1.321s (757 q/s)  | 320     | 323          | 131           | 200            | 140     |
| 10,000  | 9.731s (1027 q/s) | 1100    | 1124         | 517           | 666            | 166     |
| 50,000  | 55.8s (895 q/s)   | 5064    | 5100         | 2200          | 2600           | 140     |
| 100,000 | 129.6s (771 q/s)  | 9577    | 9600         | 4300          | 4900           | 140     |

Here we see that we basically just load everything to heap. So memory is consumed twice - by LMDB and by
deserialized objects in heap that are retained during whole query running process.

## Test 3. Small nodes + Range filters

Create from 1000 to 100,000 small nodes and a page for each of them. Then query with

```graphql
query($id: String!, $isOdd: Boolean!, $step: Int!, $withRangeFilter: Boolean!) {
  test(stepStr: { eq: $id }) {
    step
    text
  }
  allTest(filter: { isOdd: { eq: $isOdd }, step: { gte: $step } }, limit: 50) {
    nodes {
      step
    }
  }
}
```

### Latest `gatsby@3.3.0` (no LMDB):

| Pages   | page queries    | rss, MB | rss peak, MB | heap used, MB | heap total, MB | ext, MB |
| ------- | --------------- | ------- | ------------ | ------------- | -------------- | ------- |
| 1000    | 1.482 (675 q/s) | 204     | 204          | 90            | 149            | 138     |
| 10,000  | 22.12 (452 q/s) | 354     | 428          | 126           | 294            | 138     |
| 30,000  | 199 (150 q/s)   | 452     | 622          | 190           | 395            | 138     |
| 50,000  | 508 (98 q/s)    | 551     | 829          | 269           | 489            | 138     |
| 100,000 | 1990 (50 q/s)   | 845     | 2964         | 457           | 777            | 138     |

### Gatsby+LMDB:

| Pages   | page queries     | rss, MB | rss peak, MB | heap used, MB | heap total, MB | ext, MB |
| ------- | ---------------- | ------- | ------------ | ------------- | -------------- | ------- |
| 1000    | 1.638s (610 q/s) | 221     | 222          | 91            | 157            | 143     |
| 10,000  | 31.8 (313 q/s)   | 395     | 487          | 111           | 250            | 138     |
| 30,000  | 140.8 (213 q/s)  | 564     | 757          | 162           | 334            | 138     |
| 50,000  | 499 (100 q/s)    | 729     | 1066         | 217           | 376            | 138     |
| 100,000 | 1279.8 (78 q/s)  | 1450    | 1854         | 351           | 617            | 138     |

Not sure why it was faster than `master` but it seems to be consistent 🤷‍

In the end also ran 100,000 queries in parallel with 3 workers:

```shell
success run page queries - 503.519s - 33189/33189 65.91/s
success run page queries - 536.047s - 33401/33401 62.31/s
success run page queries - 507.850s - 33407/33407 65.78/s
```

So essentially it took `536s` with `190 q/s` (total).
Each worker process consumed similar amounts of memory:

```shell
rss: 1.2 GB (7.1%) | heap: 550 MB / 817 MB
```
