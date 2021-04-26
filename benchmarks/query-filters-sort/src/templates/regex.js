import React from "react"
import { graphql } from "gatsby"

export default ({ data }) => {
  if (!data?.allTest?.nodes?.length) {
    throw new Error("Wrong data")
  }
  return <div>{JSON.stringify(data)}</div>
}

export const query = graphql`
  query($limit: Int, $skip: Int, $regex: String, $sort: TestSortInput) {
    allTest(
      filter: { id: { regex: $regex } }
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
