import { runJobsViaServer, seedE2e, seedSampleDemo } from "./fixtures/seed";

export default async function globalSetup() {
  await seedE2e();
  await seedSampleDemo();
  await runJobsViaServer();
}
