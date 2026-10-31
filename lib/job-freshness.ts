export function isPostedWithinWindow(
  postedTime: string | null,
  cutoff: Date,
  now: Date,
) {
  if (!postedTime) return false;
  const postedDate = new Date(postedTime);
  if (Number.isNaN(postedDate.getTime())) return false;
  return postedDate >= cutoff && postedDate <= now;
}
