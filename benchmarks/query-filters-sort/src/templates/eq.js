import React from "react"
import { graphql } from "gatsby"

export default ({ data }) => {
  if (!data?.allTest?.nodes) {
    throw new Error("Bad query result")
  }
  return <div>{JSON.stringify(data)}</div>
}

export const query = graphql`
  query($pageNumAsStr: String!) {
    allTest(filter: { testEq: { eq: $pageNumAsStr } }, limit: 1) {
      nodes {
        nodeNum
      }
    }
  }
`
