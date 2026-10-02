export function notFound(req, _res, next) {
    const error = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
    error.status = 404;
    next(error);
}

export function errorHandler(error, _req, res, _next) {
    if (error.code === "LIMIT_FILE_SIZE") return res.status(413).json({ success: false, message: "The uploaded identity document must be 5 MB or smaller." });
    if (error.code === "LIMIT_UNEXPECTED_FILE") return res.status(400).json({ success: false, message: "Unexpected file field in the request." });
    if (error.status === 400 && error.message?.includes("identity document")) return res.status(400).json({ success: false, message: error.message });
    const status = Number(error.status) || 500;
    if (status >= 500) console.error(error);
    res.status(status).json({ success: false, message: status >= 500 ? "An unexpected server error occurred." : error.message });
}
