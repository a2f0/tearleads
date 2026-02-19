export async function runBillingSummary(): Promise<void> {
  const db = await import('../db/postgres');
  const queries = await import('../db/queries');

  console.log('\nConnecting to database...');
  const connected = await db.testConnection();
  if (!connected) {
    console.error('Failed to connect to database');
    process.exit(1);
  }

  console.log('\nUser Accounting Summary\n');

  const userCounts = await queries.getUserCountSummary();
  console.log('Users:');
  console.log(`  Total:    ${userCounts.totalUsers}`);
  console.log(`  Active:   ${userCounts.activeUsers}`);
  console.log(`  Disabled: ${userCounts.disabledUsers}`);

  const billing = await queries.getOrganizationBilling();
  console.log(`\nOrganization Billing (${billing.length} accounts):`);
  const statusCounts: Record<string, number> = {};
  for (const b of billing) {
    statusCounts[b.entitlementStatus] =
      (statusCounts[b.entitlementStatus] ?? 0) + 1;
  }
  for (const [status, count] of Object.entries(statusCounts)) {
    console.log(`  ${status}: ${count}`);
  }

  const subs = await queries.getSubscriptionsByProduct();
  if (subs.length > 0) {
    console.log('\nSubscriptions by Product:');
    for (const s of subs) {
      console.log(`  ${s.productId ?? 'none'} (${s.status}): ${s.count}`);
    }
  }

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const aiUsage = await queries.getAiUsageSummary(startOfMonth, endOfMonth);

  if (aiUsage.length > 0) {
    let totalTokens = 0;
    let totalRequests = 0;
    for (const usage of aiUsage) {
      totalTokens += Number(usage.totalTokens);
      totalRequests += Number(usage.requestCount);
    }
    console.log(
      `\nAI Usage (${now.toLocaleString('default', { month: 'long' })}):`
    );
    console.log(`  Total tokens:   ${totalTokens.toLocaleString()}`);
    console.log(`  Total requests: ${totalRequests.toLocaleString()}`);
    console.log(`  Organizations:  ${aiUsage.length}`);
  }

  await db.closePool();
}
