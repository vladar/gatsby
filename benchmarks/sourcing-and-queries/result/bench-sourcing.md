# LMDB sourcing overhead benchmark

## Methodology

The benchmark creates many simple nodes and measures `source nodes` step only.
It exits right after `apiRunnerNode` call in `utils/sourceNodes`.
Before exiting the benchmark forces garbage collection, waits for 5 seconds and captures memory profile.

Changes in `utils/sourceNodes.js:`

```js
const start = Date.now()

await (0, _apiRunnerNode.default)(`sourceNodes`, {
  traceId: `initial-sourceNodes`,
  waitForCascadingActions: true,
  deferNodeMutation,
  parentSpan,
  webhookBody: webhookBody || {},
  pluginName,
})

console.log(`Source nodes took: ${(Date.now() - start) / 1000}`)

// LMDB bench only:
// await nodesDb.forceCommit()
// console.log(`With db commit: ${(Date.now() - start) / 1000}`)

global.gc()
await new Promise(resolve => setTimeout(resolve, 5000))
console.log(ptop.toString())
process.exit(0)
```

This way we only measure writes. In `utils/sourceNodes.js` we also traverse all
nodes with `getNodes` and I wanted to explicitly exclude this step.

## Machine

Ran all tests on Linode VPS with 8 dedicated CPUs (2200 Mhz) and 16 GB of RAM.

## Test 1. Small nodes

Create from 1000 to 10,000,000 small nodes like this
(adding await to bot block event loop completely)

```js
exports.sourceNodes = async ({ actions: { createNode } }) => {
  for (let step = 0; step < NUM_PAGES; step++) {
    createNode({
      id: `/path/${step}/`,
      step,
      internal: {
        type: `Test`,
        contentDigest: String(step),
      },
    })
    if (step % 10000 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  }
}
```

### Latest `gatsby@3.3.0` (no LMDB):

`source nodes` time includes `redux.saveState()`.
Time without state persistence - in parentheses.

|            | source nodes, s | rss, MB | heap used, MB | heap total, MB | ext, MB |
| ---------- | --------------- | ------- | ------------- | -------------- | ------- |
| 1000       | 0.3 (0.29)      | 193     | 85            | 138            | 138     |
| 10,000     | 1.413 (1.373)   | 202     | 89            | 146            | 138     |
| 100,000    | 10.34 (9.8)     | 378     | 130           | 311            | 154     |
| 1,000,000  | 105.15 (97.5)   | 1200    | 519           | 1100           | 303     |
| 10,000,000 | OOM             | 8500    | 7951          | OOM            | ?       |

10 millions `--max_old_space_size=8192` ran out of memory after 1500 sec.

### Gatsby+LMDB with `10000` nodes in sync chunk

Note: only `nodes` and `nodesByType` are stored in lmdb. `touchedNodes` and `queries`
reducers are still in-memory.

| Node count | source nodes, s | rss, MB | heap used, MB | heap total, MB | ext, MB |
| ---------- | --------------- | ------- | ------------- | -------------- | ------- |
| 1,000      | 0.373           | 197     | 87            | 139            | 138     |
| 10,000     | 1.937           | 235     | 106           | 155            | 144     |
| 100,000    | 16.791          | 563     | 181           | 336            | 178     |
| 1,000,000  | 151.341         | 934     | 166           | 575            | 173     |
| 10,000,000 | 1787.643        | 2900    | 766           | 1400           | 173     |

Peak memory for 10 millions nodes was `3005 MB`.

To put those numbers in perspective: the same 10 millions of nodes recorded directly to `lmdb-store` took `220s`.
So the remaining `1567s` are spent somewhere in `createNode` and our redux
(we query LMDB there too).

## Test 2. Nodes with 40kb of text each

Same as Test 1, but added a field `text` containing `40kb` of Lorem Ipsum text:

```js
const text = `...`
exports.sourceNodes = async ({ actions: { createNode } }) => {
  for (let step = 0; step < NUM_PAGES; step++) {
    createNode({
      id: `/path/${step}/`,
      step,
      text: `${text}${step}`,
      internal: {
        type: `Test`,
        contentDigest: String(step),
      },
    })
    if (step % 10000 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  }
}
```

### Latest `gatsby@3.3.0` (no LMDB):

| Node count | source nodes, s | rss, MB | rss peak, MB | heap used, MB | heap total, MB | ext, MB |
| ---------- | --------------- | ------- | ------------ | ------------- | -------------- | ------- |
| 1000       | 0.378 (0.282)   | 216     | 262          | 126           | 170            | 178     |
| 10,000     | 2.156 (1.397)   | 598     | 991          | 492           | 584            | 541     |
| 100,000    | 18.218 (9.571)  | 4400    | 8287         | 4100          | 4800           | 541     |
| 150,000    | 26.283 (14.378) | 6600    | 12355        | 6200          | 7300           | 1400    |
| 500,000    | OOM (48.325)    | ?       | 16000+       | ?             | ?              | ?       |
| 1,000,000  | OOM (94.6)      | ?       | 16000+       | ?             | ?              | ?       |

Every step with node count higher than 150,000 OOMed during persistence step and was killed by the OS.

1 million OOMed and was killed by the OS (total RAM on this machine is 16GB).
That's why ran it again with 500,000 items

### Gatsby+LMDB with `10000` nodes in sync chunk:

| Node count | source nodes, s | rss, MB | rss peak, MB | heap used, MB | heap total, MB | ext, MB |
| ---------- | --------------- | ------- | ------------ | ------------- | -------------- | ------- |
| 1000       | 1.564 (0.489)   | 371     | 410          | 91            | 150            | 192     |
| 10,000     | 4.849 (4.681)   | 887     | 1092         | 91            | 347            | 414     |
| 100,000    | 41.25 (41.16)   | 3100    | 3176         | 97            | 483            | 414     |
| 150,000    | 64.9 (64.85)    | 4300    | 4620         | 102           | 490            | 422     |
| 500,000    | 215.6 (215.5)   | 11000   | 11500        | 123           | 525            | 437     |
| 1,000,000  | OOM             | ?       | 16000+       | ?             | ?              | ?       |

Looks like blocked event loop didn't give LMDB enough time to clear buffers
(and even `setTimeout(_, 0)` didn't help).

### Gatsby+LMDB with `50` nodes in sync chunk:

After playing a lot with sync chunk sizes and timeouts, this turned out to be the best
setting for this test:

```js
if (step % 50 === 0) {
  await new Promise(resolve => setTimeout(resolve, 3))
}
```

| Node count | source nodes, s | rss, MB | rss peak, MB | heap used, MB | heap total, MB | ext, MB |
| ---------- | --------------- | ------- | ------------ | ------------- | -------------- | ------- |
| 1000       | 0.552 (0.529)   | 253     | 269          | 91            | 146            | 181     |
| 10,000     | 3.409 (3.386)   | 265     | 412          | 87            | 144            | 168     |
| 100,000    | 27.54 (27.51)   | 579     | 599          | 92            | 196            | 211     |
| 150,000    | 40.61 (40.58)   | 652     | 684          | 97            | 184            | 181     |
| 500,000    | 135.88 (135.86) | 1200    | 1238         | 114           | 190            | 152     |
| 1,000,000  | 276.9 (276.8)   | 2000    | 2056         | 143           | 269            | 219     |
