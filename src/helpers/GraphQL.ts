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
        account: accountByAccountId {
          id
          alias
          idSs58
          __typename
        }
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
  slashedEvents: accountFundingEventsByEpochId(condition: {type: SLASHED}) {
    groupedAggregates(groupBy: ACCOUNT_ID) {
      accountId: keys
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

export const getValidatorLatestBlockInfo = `
query getValidatorLatestBlockInfo($idSs58: String!) {
  accounts: allAccounts(condition: {idSs58: $idSs58}) {
    nodes {
      ...AccountWithPossibleValidator
      __typename
    }
    __typename
  }
}

fragment AccountWithPossibleValidator on Account {
  id
  alias
  idSs58
  boundRedeemAddress
  historicRewards: accountEpochBalanceChangesByAccountId(
    filter: {endOfEpochBalance: {isNull: false}}
  ) {
    aggregates {
      sum {
        startOfEpochBalance
        endOfEpochBalance
        balanceChange
        __typename
      }
      __typename
    }
    __typename
  }
  currentRewards: accountEpochBalanceChangesByAccountId(
    last: 1
    filter: {endOfEpochBalance: {isNull: true}}
  ) {
    nodes {
      startOfEpochBalance
      balanceChange
      __typename
    }
    __typename
  }
  validators: validatorsByAccountId {
    nodes {
      id
      lastHeartbeatBlockId
      cfeVersion: cfeVersionId
      membership: authorityMembershipsByValidatorId(last: 1) {
        nodes {
          epochId
          __typename
        }
        __typename
      }
      __typename
    }
    __typename
  }
  __typename
}
`

export const getAuthorityMembershipsForValidator = `
query getAuthorityMembershipsForValidator($validatorId: Int, $accountId: Int, $first: Int, $offset: Int) {
  memberships: allAuthorityMemberships(
    orderBy: ID_DESC
    first: $first
    offset: $offset
    condition: {validatorId: $validatorId}
  ) {
    pageInfo {
      startCursor
      hasPreviousPage
      hasNextPage
      endCursor
      __typename
    }
    totalCount
    edges {
      node {
        ...AuthorityMembershipWithEpoch
        __typename
      }
      __typename
    }
    __typename
  }
}

fragment AuthorityMembershipWithEpoch on AuthorityMembership {
  id
  reward
  epoch: epochByEpochId {
    id
    startBlockId
    endBlockId
    bond
    totalBonded
    eventType: accountFundingEventsByEpochId(condition: {accountId: $accountId}) {
      groupedAggregates(groupBy: TYPE) {
        type: keys
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

export const paginatedPenaltiesByValidatorQuery = `
query paginatedPenaltiesByValidatorQuery($validatorId: Int, $first: Int, $last: Int, $after: Cursor, $before: Cursor) {
  penalties: allPenalties(
    condition: {validatorId: $validatorId}
    orderBy: ID_DESC
    after: $after
    before: $before
    first: $first
    last: $last
  ) {
    pageInfo {
      startCursor
      endCursor
      hasNextPage
      hasPreviousPage
      __typename
    }
    edges {
      node {
        ...Penalty
        __typename
      }
      __typename
    }
    __typename
  }
}

fragment Penalty on Penalty {
  id
  validator: validatorByValidatorId {
    id
    account: accountByAccountId {
      idSs58
      alias
      __typename
    }
    __typename
  }
  block: blockByBlockId {
    id
    timestamp
    __typename
  }
  reason
  amount
  __typename
}
`

export const getExtrinsicsByAccount = `
query getExtrinsicsByAccount($accountId: Int, $first: Int, $last: Int, $after: Cursor, $before: Cursor) {
  extrinsics: allExtrinsics(
    condition: {submitterId: $accountId}
    orderBy: ID_DESC
    after: $after
    before: $before
    first: $first
    last: $last
  ) {
    pageInfo {
      hasPreviousPage
      startCursor
      hasNextPage
      endCursor
      __typename
    }
    edges {
      node {
        ...Extrinsic
        __typename
      }
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
  account: accountBySubmitterId {
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
