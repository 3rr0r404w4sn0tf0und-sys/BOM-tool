// Express 4 does not catch rejected promises thrown inside async route
// handlers -- if one throws, the request just hangs forever with no
// response sent (this was the "clicking a BOM loads forever" bug).
// Wrap any async handler in this so errors reach the global error
// middleware in index.js and actually produce a response.
export function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
