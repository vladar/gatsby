import React from "react"
import { graphql } from "gatsby"

export default ({ data }) => {
  if (!data?.allTest?.nodes) {
    throw new Error("Wrong data")
  }
  return <div>{JSON.stringify(data)}</div>
}

export const query = graphql`
  query($pageNum: Int, $nodesTotal: Int, $limit: Int, $sort: TestSortInput) {
    allTest(
      filter: { nodeNum: { gt: $pageNum, lt: $nodesTotal } }
      sort: $sort
      limit: $limit
    ) {
      nodes {
        nodeNum
        text
      }
    }
  }
`
