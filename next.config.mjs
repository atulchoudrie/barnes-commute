/** @type {import('next').NextConfig} */
export default {
  // /api/widget serves the Scriptable script, so it has to be deployed with the function.
  outputFileTracingIncludes: { "/api/widget": ["./widgets/barnes-commute.js"] },
};
