export interface CreatorNameLike {
  firstName: string;
  lastName: string;
}

export type CreatorNameMatchType =
  | "normalized-full-name"
  | "same-last-name-initial";

export function normalizeNamePart(value: string) {
  return (value || "")
    .toLowerCase()
    .replace(/[`~!@#$%^&*()_|+\-=?;:'",.<>{}\[\]\\\/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getNormalizedFullName(creator: CreatorNameLike) {
  const firstName = normalizeNamePart(creator.firstName || "");
  const lastName = normalizeNamePart(creator.lastName || "");
  return `${firstName} ${lastName}`.trim();
}

export function getFirstInitial(name: string) {
  const token = normalizeNamePart(name).split(" ")[0] || "";
  return token ? token[0] : "";
}

export function isInitialLike(name: string) {
  const token = normalizeNamePart(name).split(" ")[0] || "";
  return token.length === 1;
}

export function getCreatorNameMatchType(
  mainCreator: CreatorNameLike,
  candidate: CreatorNameLike,
): CreatorNameMatchType | null {
  const mainFirstName = normalizeNamePart(mainCreator.firstName || "");
  const mainLastName = normalizeNamePart(mainCreator.lastName || "");
  const candidateFirstName = normalizeNamePart(candidate.firstName || "");
  const candidateLastName = normalizeNamePart(candidate.lastName || "");

  const mainFullName = `${mainFirstName} ${mainLastName}`.trim();
  const candidateFullName = `${candidateFirstName} ${candidateLastName}`.trim();
  if (mainFullName && mainFullName === candidateFullName) {
    return "normalized-full-name";
  }

  const sameLastName = mainLastName && mainLastName === candidateLastName;
  if (!sameLastName) {
    return null;
  }
  const mainInitial = getFirstInitial(mainFirstName);
  const candidateInitial = getFirstInitial(candidateFirstName);
  if (!mainInitial || !candidateInitial || mainInitial !== candidateInitial) {
    return null;
  }
  if (isInitialLike(mainFirstName) || isInitialLike(candidateFirstName)) {
    return "same-last-name-initial";
  }
  return null;
}
