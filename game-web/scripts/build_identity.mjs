// A PR event's GITHUB_SHA can be GitHub's synthetic merge commit.
// The actual checked-out commit is the CI build identity; Vercel and deliberate local overrides take precedence.
export function selectBuildIdentity({vercelSha,explicitBuildId,checkoutSha,eventSha}) {
  return [vercelSha,explicitBuildId,checkoutSha,eventSha,"dev"].find(candidate=>typeof candidate==="string"&&candidate.trim().length>0);
}
