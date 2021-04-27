import React from "react"
import { graphql } from "gatsby"

export default ({ data }) => {
  if (!data?.allTest?.nodes?.length) {
    throw new Error("Wrong data")
  }
  return <div>{JSON.stringify(data)}</div>
}

export const query = graphql`
  query($limit: Int, $regex: String, $sort: TestSortInput) {
    allTest(
      filter: { id: { regex: $regex } }
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
