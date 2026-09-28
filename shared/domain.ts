/**
 * Core domain vocabulary shared by the API, workers, agents and AI layer.
 * Values are persisted in PostgreSQL as text, so never rename a member
 * without a migration.
 */

export const AutomationStatus = {
  AUTOMATED: "AUTOMATED",
  SEMI_AUTOMATED: "SEMI_AUTOMATED",
  USER_ACTION_REQUIRED: "USER_ACTION_REQUIRED",
  MANUAL_REVIEW: "MANUAL_REVIEW",
  UNSUPPORTED: "UNSUPPORTED",
} as const;
export type AutomationStatus = (typeof AutomationStatus)[keyof typeof AutomationStatus];

export const DiscoveryMethod = {
  SEARCH_API: "SEARCH_API",
  SITE_SEARCH: "SITE_SEARCH",
  DIRECT_URL_CHECK: "DIRECT_URL_CHECK",
  USER_SUBMITTED_URL: "USER_SUBMITTED_URL",
} as const;
export type DiscoveryMethod = (typeof DiscoveryMethod)[keyof typeof DiscoveryMethod];

export const RemovalMethod = {
  WEB_FORM: "WEB_FORM",
  EMAIL_REQUEST: "EMAIL_REQUEST",
  SEARCH_ENGINE_REMOVAL: "SEARCH_ENGINE_REMOVAL",
  ACCOUNT_SETTINGS: "ACCOUNT_SETTINGS",
  USER_CONTROLLED_SITE: "USER_CONTROLLED_SITE",
  POSTAL_MAIL: "POSTAL_MAIL",
  NONE: "NONE",
} as const;
export type RemovalMethod = (typeof RemovalMethod)[keyof typeof RemovalMethod];

export const IdentifierType = {
  FULL_NAME: "FULL_NAME",
  ALIAS: "ALIAS",
  EMAIL: "EMAIL",
  PHONE: "PHONE",
  USERNAME: "USERNAME",
  DOMAIN: "DOMAIN",
  BUSINESS_NAME: "BUSINESS_NAME",
  LOCATION: "LOCATION",
  ADDRESS: "ADDRESS",
  DATE_OF_BIRTH: "DATE_OF_BIRTH",
} as const;
export type IdentifierType = (typeof IdentifierType)[keyof typeof IdentifierType];

/** Identifier types whose raw value must never be sent to the browser unmasked by default. */
export const SENSITIVE_IDENTIFIER_TYPES: ReadonlySet<IdentifierType> = new Set([
  "EMAIL",
  "PHONE",
  "ADDRESS",
  "DATE_OF_BIRTH",
  "ALIAS",
]);

export const ExposureCategory = {
  DATA_BROKER: "DATA_BROKER",
  PEOPLE_SEARCH: "PEOPLE_SEARCH",
  SOCIAL: "SOCIAL",
  DIRECTORY: "DIRECTORY",
  PROFESSIONAL: "PROFESSIONAL",
  BUSINESS: "BUSINESS",
  SEARCH_RESULT: "SEARCH_RESULT",
  USER_CONTROLLED: "USER_CONTROLLED",
  NEWS_OR_PUBLIC_INTEREST: "NEWS_OR_PUBLIC_INTEREST",
  OTHER: "OTHER",
} as const;
export type ExposureCategory = (typeof ExposureCategory)[keyof typeof ExposureCategory];

export const DataType = {
  NAME: "NAME",
  HOME_ADDRESS: "HOME_ADDRESS",
  PHONE: "PHONE",
  EMAIL: "EMAIL",
  AGE_OR_DOB: "AGE_OR_DOB",
  RELATIVES: "RELATIVES",
  USERNAME: "USERNAME",
  PHOTO: "PHOTO",
  EMPLOYMENT: "EMPLOYMENT",
  BIOGRAPHY: "BIOGRAPHY",
  LOCATION: "LOCATION",
} as const;
export type DataType = (typeof DataType)[keyof typeof DataType];

/** Lifecycle of a discovered exposure (spec §12). */
export const RecordStatus = {
  DISCOVERED: "DISCOVERED",
  NEEDS_REVIEW: "NEEDS_REVIEW",
  READY: "READY",
  AWAITING_APPROVAL: "AWAITING_APPROVAL",
  SUBMITTED: "SUBMITTED",
  AWAITING_VERIFICATION: "AWAITING_VERIFICATION",
  REMOVED: "REMOVED",
  PARTIALLY_REMOVED: "PARTIALLY_REMOVED",
  FAILED: "FAILED",
  REQUIRES_USER_ACTION: "REQUIRES_USER_ACTION",
  REAPPEARED: "REAPPEARED",
  NO_ACTION_AVAILABLE: "NO_ACTION_AVAILABLE",
  DISMISSED: "DISMISSED",
} as const;
export type RecordStatus = (typeof RecordStatus)[keyof typeof RecordStatus];

/** Statuses in which an exposure is considered "live" for scoring/reporting. */
export const ACTIVE_EXPOSURE_STATUSES: readonly RecordStatus[] = [
  "DISCOVERED",
  "NEEDS_REVIEW",
  "READY",
  "AWAITING_APPROVAL",
  "SUBMITTED",
  "AWAITING_VERIFICATION",
  "PARTIALLY_REMOVED",
  "FAILED",
  "REQUIRES_USER_ACTION",
  "REAPPEARED",
  "NO_ACTION_AVAILABLE",
];

export const RemovalRequestStatus = {
  DRAFT: "DRAFT",
  AWAITING_APPROVAL: "AWAITING_APPROVAL",
  APPROVED: "APPROVED",
  IN_PROGRESS: "IN_PROGRESS",
  REQUIRES_USER_ACTION: "REQUIRES_USER_ACTION",
  SUBMITTED: "SUBMITTED",
  AWAITING_VERIFICATION: "AWAITING_VERIFICATION",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
} as const;
export type RemovalRequestStatus = (typeof RemovalRequestStatus)[keyof typeof RemovalRequestStatus];

/**
 * What a verification check actually established (spec §42). These are
 * deliberately distinct — "no longer detected" is weaker than "removed from source".
 */
export const VerificationOutcome = {
  STILL_PRESENT: "STILL_PRESENT",
  REMOVED_FROM_SOURCE: "REMOVED_FROM_SOURCE",
  REMOVED_FROM_SEARCH_RESULTS: "REMOVED_FROM_SEARCH_RESULTS",
  NO_LONGER_DETECTED: "NO_LONGER_DETECTED",
  PARTIALLY_REMOVED: "PARTIALLY_REMOVED",
  INCONCLUSIVE: "INCONCLUSIVE",
} as const;
export type VerificationOutcome = (typeof VerificationOutcome)[keyof typeof VerificationOutcome];

export const ApprovalMode = {
  AUTOMATIC: "AUTOMATIC",
  APPROVAL_REQUIRED: "APPROVAL_REQUIRED",
  MANUAL: "MANUAL",
} as const;
export type ApprovalMode = (typeof ApprovalMode)[keyof typeof ApprovalMode];

export const PriorityLevel = { HIGH: "HIGH", MEDIUM: "MEDIUM", LOW: "LOW" } as const;
export type PriorityLevel = (typeof PriorityLevel)[keyof typeof PriorityLevel];

export const RemovalPathway = {
  GENERAL_PRIVACY_OPT_OUT: "GENERAL_PRIVACY_OPT_OUT",
  DATA_BROKER_OPT_OUT: "DATA_BROKER_OPT_OUT",
  SEARCH_RESULT_PRIVACY_REMOVAL: "SEARCH_RESULT_PRIVACY_REMOVAL",
  OUTDATED_CONTENT: "OUTDATED_CONTENT",
  COPYRIGHT: "COPYRIGHT",
  IMPERSONATION: "IMPERSONATION",
  PERSONAL_INFORMATION_EXPOSURE: "PERSONAL_INFORMATION_EXPOSURE",
  USER_CONTROLLED_WEBSITE: "USER_CONTROLLED_WEBSITE",
  PLATFORM_PRIVACY_REQUEST: "PLATFORM_PRIVACY_REQUEST",
  JURISDICTIONAL_DELETION_REQUEST: "JURISDICTIONAL_DELETION_REQUEST",
} as const;
export type RemovalPathway = (typeof RemovalPathway)[keyof typeof RemovalPathway];

export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export const WorkflowStepType = {
  OPEN_URL: "OPEN_URL",
  SEARCH: "SEARCH",
  SELECT_RESULT: "SELECT_RESULT",
  FILL_FIELD: "FILL_FIELD",
  UPLOAD_USER_PROVIDED_DOCUMENT: "UPLOAD_USER_PROVIDED_DOCUMENT",
  WAIT_FOR_EMAIL: "WAIT_FOR_EMAIL",
  USER_CONFIRMATION: "USER_CONFIRMATION",
  VERIFY_EMAIL: "VERIFY_EMAIL",
  SUBMIT: "SUBMIT",
  SEND_EMAIL: "SEND_EMAIL",
  WAIT: "WAIT",
  CHECK_STATUS: "CHECK_STATUS",
  VERIFY_REMOVAL: "VERIFY_REMOVAL",
} as const;
export type WorkflowStepType = (typeof WorkflowStepType)[keyof typeof WorkflowStepType];

export const WorkflowState = {
  PENDING: "PENDING",
  RUNNING: "RUNNING",
  PAUSED_FOR_USER: "PAUSED_FOR_USER",
  WAITING: "WAITING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
} as const;
export type WorkflowState = (typeof WorkflowState)[keyof typeof WorkflowState];

export const UserActionKind = {
  EMAIL_VERIFICATION: "EMAIL_VERIFICATION",
  HUMAN_VERIFICATION: "HUMAN_VERIFICATION",
  IDENTITY_DOCUMENT: "IDENTITY_DOCUMENT",
  CONFIRM_SUBMISSION: "CONFIRM_SUBMISSION",
  MANUAL_OPT_OUT: "MANUAL_OPT_OUT",
  SEARCH_ENGINE_FORM: "SEARCH_ENGINE_FORM",
  SITE_OWNER_CHANGE: "SITE_OWNER_CHANGE",
  REVIEW_MATCH: "REVIEW_MATCH",
} as const;
export type UserActionKind = (typeof UserActionKind)[keyof typeof UserActionKind];

/** A pending human step, rendered as an ACTION REQUIRED card. */
export interface UserAction {
  kind: UserActionKind;
  title: string;
  message: string;
  /** Public URL the user may open to complete the step (never contains secrets). */
  url?: string;
  /** Ordered, plain-language instructions. */
  instructions?: string[];
  /** Buttons offered in the UI: e.g. "done", "skip", "continue_manually". */
  choices: Array<"done" | "skip" | "continue_manually" | "upload_document">;
}

export const NotificationKind = {
  REMOVED: "REMOVED",
  NEW_EXPOSURE: "NEW_EXPOSURE",
  REAPPEARED: "REAPPEARED",
  ACTION_REQUIRED: "ACTION_REQUIRED",
  REQUEST_SUBMITTED: "REQUEST_SUBMITTED",
  REQUEST_FAILED: "REQUEST_FAILED",
  SCAN_COMPLETED: "SCAN_COMPLETED",
  PROVIDER_WARNING: "PROVIDER_WARNING",
  ACCOUNT: "ACCOUNT",
} as const;
export type NotificationKind = (typeof NotificationKind)[keyof typeof NotificationKind];

export type Severity = "success" | "info" | "warning" | "critical";

export const PlanId = { FREE: "FREE", PRO: "PRO", FAMILY: "FAMILY", BUSINESS: "BUSINESS" } as const;
export type PlanId = (typeof PlanId)[keyof typeof PlanId];

export const ProfileRelationship = {
  SELF: "SELF",
  FAMILY_MEMBER: "FAMILY_MEMBER",
  EMPLOYEE: "EMPLOYEE",
  COMPANY: "COMPANY",
} as const;
export type ProfileRelationship = (typeof ProfileRelationship)[keyof typeof ProfileRelationship];

export type UserRole = "user" | "admin";
