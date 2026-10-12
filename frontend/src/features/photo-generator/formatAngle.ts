/** A straightening angle for display: one decimal, with a true minus sign. Kept out of the component files so they hot-reload. */
export const formatAngle = (degrees: number) => `${degrees < 0 ? "−" : ""}${Math.abs(degrees).toFixed(1)}`;
