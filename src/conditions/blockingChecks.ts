import { ConditionConfig } from './../config'
import { PullRequestInfo } from '../models'
import { ConditionResult } from '../condition'
import { groupByLastMap, flatMap } from '../utils'
import { CheckStatusState } from '../github-models'
import myAppId from '../myappid'

function requiredChecks (pullRequestInfo: PullRequestInfo): Array<String> {
  const baseRef = pullRequestInfo.baseRef.name
  const branchProtectionRules = pullRequestInfo.repository.branchProtectionRules
  const branchProtectionRulesForBaseRef = branchProtectionRules.nodes.find(rules => rules.pattern === baseRef)
  if (branchProtectionRulesForBaseRef) {
    return branchProtectionRulesForBaseRef.requiredStatusCheckContexts
  }
  return []
}

export default function doesNotHaveBlockingChecks (
  config: ConditionConfig,
  pullRequestInfo: PullRequestInfo
): ConditionResult {
  const requiredChecksNames = requiredChecks(pullRequestInfo)
  let checkRuns = flatMap(pullRequestInfo.commits.nodes,
    commit => flatMap(commit.commit.checkSuites.nodes,
      checkSuite => checkSuite.checkRuns.nodes.map(
        checkRun => ({
          ...checkRun,
          checkSuite
        }))
    )
  ).filter(checkRun => (
    checkRun.checkSuite.app && checkRun.checkSuite.app.databaseId) !== myAppId
  )
  if (config.blockingRequiredChecksOnly) {
    checkRuns = checkRuns.filter(
      checkRun => requiredChecksNames.includes(checkRun.name)
    )
    console.log({
      pullRequestNumber: pullRequestInfo.number,
      requiredChecksNames: requiredChecksNames,
      checkRuns: checkRuns
    })
    if (checkRuns.length !== requiredChecksNames.length) {
      return {
        status: 'pending',
        message: 'There are still pending required checks'
      }
    }
  }
  const allChecksCompleted = checkRuns.every(
    checkRun => checkRun.status === CheckStatusState.COMPLETED
  )
  if (!allChecksCompleted) {
    return {
      status: 'pending',
      message: 'There are still pending checks'
    }
  }
  const checkConclusions = groupByLastMap(
    checkRun => checkRun.conclusion || 'UNKNOWN',
    _ => true,
    checkRuns
  )
  const checksBlocking =
    checkConclusions.UNKNOWN ||
    checkConclusions.FAILURE ||
    checkConclusions.CANCELLED ||
    checkConclusions.TIMED_OUT ||
    checkConclusions.ACTION_REQUIRED
  if (checksBlocking) {
    return {
      status: 'fail',
      message: 'There are blocking checks'
    }
  }
  return {
    status: 'success'
  }
}
