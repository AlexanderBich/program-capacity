// Load test against a running stack. Start it with the rate limit out of the way:
//   API_RATE_LIMIT_PER_MINUTE=100000000 docker compose up -d --build api
//   k6 run program-capacity-back/load/capacity.k6.js
import { check, fail } from "k6";
import http from "k6/http";
import { Counter } from "k6/metrics";

const API = __ENV.API_URL || "http://localhost:4000/api/v1";
const PASSWORD = __ENV.DEMO_PASSWORD || "capacity-demo-password";
const DURATION = __ENV.DURATION || "60s";
const PROGRAM_COUNT = 20;

const busyResponses = new Counter("program_busy_responses");

const SCENARIOS = {
  across_programs: {
    executor: "constant-vus",
    vus: 40,
    duration: DURATION,
    exec: "reserveAndReleaseAcrossPrograms",
  },
  // Every writer on one row lock: the worst case for this design.
  one_hot_program: {
    executor: "constant-vus",
    vus: 20,
    duration: DURATION,
    exec: "reserveAndReleaseOnHotProgram",
  },
  availability_reads: {
    executor: "constant-arrival-rate",
    rate: 300,
    timeUnit: "1s",
    duration: DURATION,
    preAllocatedVUs: 50,
    maxVUs: 200,
    exec: "readAvailability",
  },
};

export const options = {
  setupTimeout: "2m",
  // k6 run -e ONLY=one_hot_program ... measures one scenario on its own.
  scenarios: __ENV.ONLY ? { [__ENV.ONLY]: SCENARIOS[__ENV.ONLY] } : SCENARIOS,
  // Guards against a regression, not promises: they hold on a laptop running everything at once.
  thresholds: {
    checks: ["rate==1"],
    "http_req_duration{operation:reserve_across_programs}": ["p(95)<500"],
    "http_req_duration{operation:release_across_programs}": ["p(95)<500"],
    "http_req_duration{operation:reserve_hot_program}": ["p(95)<2000"],
    "http_req_duration{operation:release_hot_program}": ["p(95)<2000"],
    "http_req_duration{operation:read_availability}": ["p(95)<250"],
  },
};

const login = (email) => {
  const response = http.post(`${API}/auth/login`, JSON.stringify({ email, password: PASSWORD }), {
    headers: { "Content-Type": "application/json" },
  });
  if (response.status !== 200) {
    fail(`Could not sign in as ${email}: ${response.status} ${response.body}`);
  }
  return response.json("accessToken");
};

const authorized = (token, tags = {}) => ({
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  tags,
});

export function setup() {
  const adminToken = login("admin@capacity.local");
  const operatorToken = login("operator@capacity.local");

  const createProgram = (code) => {
    const response = http.post(
      `${API}/programs`,
      JSON.stringify({
        code,
        name: `Load ${code}`,
        currency: "USD",
        creditLimit: "900000000000.00",
      }),
      authorized(adminToken),
    );
    if (response.status !== 201) {
      fail(`Could not create ${code}: ${response.status} ${response.body}`);
    }
    return response.json("id");
  };

  const runId = Date.now();
  return {
    operatorToken,
    programIds: Array.from({ length: PROGRAM_COUNT }, (_, index) =>
      createProgram(`LOAD-${runId}-${index}`),
    ),
    hotProgramId: createProgram(`LOAD-${runId}-HOT`),
  };
}

const uniqueId = (prefix) => `${prefix}-${__VU}-${__ITER}-${Date.now()}`;

const reserveAndRelease = (token, programId, scenario) => {
  const reserved = http.post(
    `${API}/programs/${programId}/reservations`,
    JSON.stringify({ invoiceId: uniqueId("INV"), amount: "100.00", currency: "USD" }),
    authorized(token, { operation: `reserve_${scenario}` }),
  );
  // Contention answered honestly: the client is told to retry, nothing changed.
  if (reserved.status === 503 && reserved.json("code") === "PROGRAM_BUSY") {
    busyResponses.add(1);
    return;
  }
  check(reserved, { "reservation created": (response) => response.status === 201 });
  if (reserved.status !== 201) {
    return;
  }

  // Retried until it lands, so that whatever was reserved is released and the books can be checked below.
  for (;;) {
    const released = http.post(
      `${API}/programs/${programId}/reservations/${reserved.json("reservation.id")}/releases`,
      JSON.stringify({ repaymentId: uniqueId("RPM"), amount: "100.00", currency: "USD" }),
      authorized(token, { operation: `release_${scenario}` }),
    );
    if (released.status === 503 && released.json("code") === "PROGRAM_BUSY") {
      busyResponses.add(1);
      continue;
    }
    check(released, { "release applied": (response) => response.status === 201 });
    return;
  }
};

export function reserveAndReleaseAcrossPrograms(data) {
  const programId = data.programIds[(__VU * 7 + __ITER) % data.programIds.length];
  reserveAndRelease(data.operatorToken, programId, "across_programs");
}

export function reserveAndReleaseOnHotProgram(data) {
  reserveAndRelease(data.operatorToken, data.hotProgramId, "hot_program");
}

export function readAvailability(data) {
  const programId = data.programIds[__ITER % data.programIds.length];
  const response = http.get(
    `${API}/programs/${programId}/availability`,
    authorized(data.operatorToken, { operation: "read_availability" }),
  );
  check(response, { "availability read": (read) => read.status === 200 });
}

/** The point of the exercise: after all of that, every program must be back to nothing reserved. */
export function teardown(data) {
  for (const programId of [...data.programIds, data.hotProgramId]) {
    const availability = http.get(
      `${API}/programs/${programId}/availability`,
      authorized(data.operatorToken),
    );
    check(availability, {
      "nothing left reserved": (response) => response.json("reserved") === "0.00",
    });
  }
}
