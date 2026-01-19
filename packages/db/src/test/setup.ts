import failOnConsole from 'vitest-fail-on-console';

// Guardrail: fail tests on console warnings/errors unless tests explicitly mock or assert them.
failOnConsole();
