import React from "react"
import { graphql } from "gatsby"

export default ({ data }) => {
  if (!data?.allTest?.nodes?.length) {
    throw new Error("Wrong data")
  }
  return <div>{JSON.stringify(data)}</div>
}

export const query = graphql`
  query($limit: Int, $skip: Int, $sort: TestSortInput) {
    allTest(
      filter: { testIn: { in: ["foo", "bar"] } }
      sort: $sort
      limit: $limit
      skip: $skip
    ) {
      nodes {
        nodeNum
        text
      }
    }
  }
`
