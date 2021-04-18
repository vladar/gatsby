import React from "react"
import { graphql } from "gatsby"

export default () => <div>Yo!</div>

export const query = graphql`
  query getTest($id: String!, $isOdd: Boolean!, $step: Int!, $withRangeFilter: Boolean!) {
    test(stepStr: { eq: $id }) {
      step
      text
    }
    allTest(filter: { isOdd: { eq: $isOdd }, step: { gte: $step } }, limit: 50) @include(if: $withRangeFilter) {
      nodes {
        step
      }
    }
  }
`
