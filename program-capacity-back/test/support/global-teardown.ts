import { StartedTestContainer } from "testcontainers";

export default async function globalTeardown() {
  const { testContainers } = globalThis as unknown as { testContainers: StartedTestContainer[] };
  await Promise.all(testContainers.map((container) => container.stop()));
}
