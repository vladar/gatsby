const NUM_PAGES = parseInt(process.env.NUM_PAGES || 1000, 10)
const NUM_NODES = parseInt(process.env.NUM_NODES || NUM_PAGES, 10)
const SORT = process.env.SORT
const FILTER = process.env.FILTER || `eq`

const ptop = require(`process-top`)()

exports.sourceNodes = async ({ actions: { createNode } }) => {
  console.log(`Creating ${NUM_NODES} nodes`)
  for (let nodeNum = 0; nodeNum < NUM_NODES; nodeNum++) {
    createNode({
      id: String(nodeNum),
      nodeNum,
      testEq: String(nodeNum),
      testIn: [`foo`, `bar`, `baz`, `foobar`][nodeNum % 4],
      testElemMatch: [
        { testIn: [`foo`, `bar`, `baz`, `foobar`][nodeNum % 4] },
        { testEq: [`foo`, `bar`, `baz`, `foobar`][nodeNum % 4] },
      ],
      text: `${nodeNum}${textGen()}`,
      sortRandom: Math.random() * NUM_NODES,
      /*
      number: nodeNum,

      shortString: String(nodeNum),
      mediumString: `test${nodeNum}`.repeat(5),
      each3rd: nodeNum % 3 === 0,
      each5th: nodeNum % 5 === 0,
      each10th: nodeNum % 10 === 0,
      array: [`foo`, `bar`, `baz`, `foo${nodeNum}`, `bar${nodeNum}`, undefined],
      object: {
        isOdd: nodeNum % 2 === 1,
        number: 5,
        foo: `foo`,
        nested: { nested: { bar: `bar`, array: [`foo`, `bar`] } },
      },
 */
      internal: {
        type: `Test`,
        contentDigest: String(nodeNum),
      },
    })
    if (nodeNum % 50 === 0) {
      await new Promise(resolve => setTimeout(resolve, 3))
    }
  }
  global.gc()
  console.log(ptop.toString())
}

const pageTemplate = require.resolve(`./src/templates/${FILTER}.js`)
exports.createPages = async ({ actions: { createPage } }) => {
  console.log(`Creating ${NUM_PAGES} pages for filter: ${FILTER}`)
  const nodesPerPage = Math.max(1, Math.round(NUM_NODES / NUM_PAGES))
  for (let pageNum = 0; pageNum < NUM_PAGES; pageNum++) {
    createPage({
      path: `/path/${pageNum}/`,
      component: pageTemplate,
      context: {
        pageNumAsStr: String(pageNum),
        intValue: pageNum,
        pageNum: pageNum,
        pagesLeft: NUM_PAGES - pageNum,
        limit: nodesPerPage,
        skip: nodesPerPage * pageNum,
        nodesTotal: NUM_NODES,
        sort: SORT
          ? { fields: ["sortRandom"], order: SORT === `1` ? `ASC` : `DESC` }
          : undefined,
        regex: `/^${String(pageNum).slice(0, 1)}/`, // node id starts with the same number as page id
      },
    })
    if (pageNum % 50 === 0) {
      await new Promise(resolve => setTimeout(resolve, 3))
    }
  }
  global.gc()
  console.log(ptop.toString())
}

function textGenRandom(length = 4128) {
  return new Array(length).join('*')
  // var result = []
  // var characters =
  //   "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  // var charactersLength = characters.length
  // for (var i = 0; i < length; i++) {
  //   result.push(characters.charAt(Math.floor(Math.random() * charactersLength)))
  // }
  // return result.join("")
}

var textGen = !process.env.TEXT ? () => `` : () => textGenRandom()
