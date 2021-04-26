import React from "react"
import { graphql } from "gatsby"

export default ({ data }) => {
  if (!data?.allTest?.nodes) {
    throw new Error("Invalid data")
  }
  return <div>{JSON.stringify(data)}</div>
}

export const query = graphql`
  query($limit: Int, $skip: Int, $sort: TestSortInput) {
    allTest(
      filter: { testIn: { nin: ["foo", "bar"] } }
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
