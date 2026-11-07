import { runAttackEvaluationSuite } from './redTeamAndSuite.js';

async function main() {
  console.log('================================================================================');
  console.log(' STEWARD — 30-INVOICE SYNTHETIC ATTACK EVALUATION SUITE');
  console.log(' Principle: AI extracts and explains. Code decides. Humans authorize exceptions.');
  console.log('================================================================================\n');

  const report = await runAttackEvaluationSuite();

  console.table(
    report.results.map((r) => ({
      ID: r.id,
      Category: r.category,
      Expected: r.expectedDecision,
      Actual: r.actualDecision,
      Pass: r.passed ? 'PASS' : 'FAIL',
      UnauthPay: r.unauthorizedPaymentOccurred ? 'YES (CRITICAL)' : 'NO',
      TimeMs: `${r.decisionTimeMs}ms`,
    }))
  );

  console.log('\n--- SUMMARY METRICS (SYNTHETIC TEST RESULTS) ---');
  console.log(`Total Test Cases       : ${report.totalTestCases}`);
  console.log(`Correct Payments (PAY) : ${report.correctPayments}`);
  console.log(`Correct Holds (HOLD)   : ${report.correctHolds}`);
  console.log(`Correct Blocks (BLOCK) : ${report.correctBlocks}`);
  console.log(`False Blocks           : ${report.falseBlocks}`);
  console.log(`False Approvals        : ${report.falseApprovals}`);
  console.log(`Unauthorized Payments  : ${report.unauthorizedPayments} (Target: 0)`);
  console.log(`Median Decision Time   : ${report.medianDecisionTimeMs} ms`);
  console.log(`Overall Suite Accuracy : ${report.accuracyPercent}%`);
  console.log(`\nDisclaimer: ${report.disclaimer}\n`);

  if (report.unauthorizedPayments > 0 || report.accuracyPercent < 100) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
