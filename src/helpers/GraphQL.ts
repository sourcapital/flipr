export const getActiveAuthorityInfo = `
query getActiveAuthorityInfo {
  epoch: allEpoches(first: 1, orderBy: ID_DESC) {
    nodes {
      ...EpochWithMemberships
      __typename
    }
    __typename
  }
  lastBlock: allBlocks(first: 1, orderBy: ID_DESC) {
    nodes {
      id
      __typename
    }
    __typename
  }
}

fragment EpochWithMemberships on Epoch {
  id
  startBlockId
  endBlockId
  memberships: authorityMembershipsByEpochId(orderBy: BID_DESC) {
    nodes {
      id
      bid
      reward
      validator: validatorByValidatorId {
        id
        idSs58
        alias
        cfeVersion: cfeVersionId
        totalMemberships: authorityMembershipsByValidatorId {
          totalCount
          __typename
        }
        __typename
      }
      __typename
    }
    __typename
  }
  slashedEvents: validatorFundingEventsByEpochId(condition: {type: SLASHED}) {
    groupedAggregates(groupBy: VALIDATOR_ID) {
      validatorId: keys
      sum {
        amount
        __typename
      }
      __typename
    }
    __typename
  }
  __typename
}
`

export const getLatestAuction = `
query GetLatestAuction {
  auction: auctionById(id: 1) {
    minActiveBid
    startBlockNumber
    endBlockNumber
    currentHeight
    projectedLockup
    redemptionPeriodAsPercentage
    targetSetSize
    __typename
  }
}
`

export const paginatedPenaltiesQuery = `
query paginatedPenaltiesQuery($first: Int, $offset: Int, $startBlockId: Int!) {
  allPenalties(
    offset: $offset
    first: $first
    orderBy: ID_DESC
    filter: {blockId: {greaterThanOrEqualTo: $startBlockId}}
  ) {
    edges {
      node {
        ...Penalty
        __typename
      }
      __typename
    }
    totalCount
    __typename
  }
}

fragment Penalty on Penalty {
  id
  validator: validatorByValidatorId {
    id
    idSs58
    alias
    __typename
  }
  blockId
  reason
  amount
  __typename
}
`

export const getValidatorLatestBlockInfo = `
query getValidatorLatestBlockInfo($idSs58: String!) {
  validators: allValidators(condition: {idSs58: $idSs58}) {
    nodes {
      ...ExplorerValidator
      __typename
    }
    __typename
  }
}

fragment ExplorerValidator on Validator {
  id
  alias
  idSs58
  lastHeartbeatBlockId
  authorityMembership: authorityMembershipsByValidatorId(last: 1) {
    nodes {
      id
      epochId
      __typename
    }
    aggregates {
      sum {
        reward
        __typename
      }
      __typename
    }
    __typename
  }
  cfeVersion: cfeVersionId
  __typename
}
`

export const getExtrinsicsByValidator = `
query getExtrinsicsByValidator($validatorId: Int, $offset: Int, $first: Int!, $maxBlock: Int!, $minBlock: Int!) {
  extrinsics: allExtrinsics(
    condition: {submitterId: $validatorId}
    orderBy: BLOCK_ID_DESC
    offset: $offset
    first: $first
    filter: {blockId: {lessThanOrEqualTo: $maxBlock, greaterThanOrEqualTo: $minBlock}}
  ) {
    nodes {
      ...Extrinsic
      __typename
    }
    __typename
  }
}

fragment Event on Event {
  id
  args
  metadata: metadatumByMetadataId {
    id
    name
    label
    __typename
  }
  __typename
}

fragment Extrinsic on Extrinsic {
  id
  args
  fee
  hash
  blockId
  indexInBlock
  signature
  success
  tip
  validator: validatorBySubmitterId {
    id
    idSs58
    __typename
  }
  block: blockByBlockId {
    id
    hash
    timestamp
    __typename
  }
  events: eventsByExtrinsicId {
    nodes {
      ...Event
      __typename
    }
    __typename
  }
  metadata: metadatumByMetadataId {
    id
    name
    label
    __typename
  }
  __typename
}
`

export const getValidators = `
query Validators {
  validators: allValidators {
    nodes {
      ...CacheValidator
      __typename
    }
    __typename
  }
}

fragment CacheValidator on Validator {
  idHex
  idSs58
  alias
  apyBp
  boundRedeemAddress
  processorId
  totalRewards
  isCurrentAuthority
  isCurrentBackup
  isQualified
  isOnline
  isBidding
  isKeyholder
  reputationPoints
  lockedBalance
  unlockedBalance
  firstFundingTimestamp
  latestFundingTimestamp
  __typename
}
`

export const getValidatorByIdSs58 = `
query GetValidatorByIdSs58($validatorId: String!) {
  validators: allValidators(condition: {idSs58: $validatorId}) {
    nodes {
      ...CacheValidator
      __typename
    }
    __typename
  }
}

fragment CacheValidator on Validator {
  idHex
  idSs58
  alias
  apyBp
  boundRedeemAddress
  processorId
  totalRewards
  isCurrentAuthority
  isCurrentBackup
  isQualified
  isOnline
  isBidding
  isKeyholder
  reputationPoints
  lockedBalance
  unlockedBalance
  firstFundingTimestamp
  latestFundingTimestamp
  __typename
}
`
