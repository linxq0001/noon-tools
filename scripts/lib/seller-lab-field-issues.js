export function createSellerLabFieldIssues() {
  let issues = [];

  return {
    reset() {
      issues = [];
    },
    record(label) {
      if (!issues.includes(label)) issues.push(label);
    },
    assertClear(stepName) {
      if (issues.length === 0) return;
      throw new Error(`${stepName} fields were not confirmed on the noon page: ${issues.join(", ")}`);
    },
    list() {
      return [...issues];
    },
  };
}
