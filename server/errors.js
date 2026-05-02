function sendError(res, status, code, message) {
  res.status(status).json({
    ok: false,
    error: {
      code,
      message
    }
  });
}

module.exports = {
  sendError
};