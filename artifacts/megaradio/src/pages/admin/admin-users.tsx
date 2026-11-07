import { subscriptionAccess } from '@workspace/db-shared/subscription-access';
import { useCallback, useMemo, useState, useEffect, useRef, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAdminViewPrefs } from "@/hooks/useAdminViewPrefs";
import { isCalendarDate } from "@/lib/admin-account-utils";
import { ResetViewButton } from "@/components/admin/ResetViewButton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Loader2,
  Search,
  Edit2,
  Trash2,
  Crown,
  Ban,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  Download,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getAvatarUrl } from "@/lib/utils";

interface UserSubscription {
  plan: 'none' | 'remove_ads' | 'premium_monthly' | 'premium_yearly' | 'premium_lifetime';
  platform: 'ios' | 'android' | 'tvos' | 'macos' | 'web' | 'stripe' | 'paddle' | 'admin';
  productId?: string;
  transactionId?: string;
  originalTransactionId?: string;
  expiresAt?: string | null;
  startedAt?: string;
  lastVerifiedAt?: string;
  isTrial?: boolean;
  isActive: boolean;
  cancelledAt?: string;
}

interface UserProfile {
  _id: string;
  email: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  avatar?: string;
  profilePicture?: string;
  authProvider?: string;
  googleId?: string;
  followers?: number;
  favorites?: number;
  subscription?: UserSubscription | null;
  createdAt?: string;
  updatedAt?: string;
  isActive?: boolean;
}

// Namespaced under `admin-users:` so the same admin preferences endpoint
// can serve other admin pages. The shared hook prefixes with `admin:` for
// localStorage automatically.
const VIEW_PREFS_KEY = "admin-users:view-prefs:v1";

// "all" = no filter applied. Other values map 1:1 to the persisted plan
// strings on IUser.subscription.plan, with "any_premium" as a convenience
// bucket covering all three premium tiers.
type PlanFilter =
  | "all"
  | "none"
  | "remove_ads"
  | "any_premium"
  | "premium_monthly"
  | "premium_yearly"
  | "premium_lifetime";

const PLAN_FILTER_VALUES: readonly PlanFilter[] = [
  "all",
  "none",
  "remove_ads",
  "any_premium",
  "premium_monthly",
  "premium_yearly",
  "premium_lifetime",
] as const;

// "all" = no filter. "email" matches the historical default where
// authProvider is unset (treated as email signups).
type AuthMethodFilter = "all" | "email" | "google" | "facebook" | "apple";

const AUTH_METHOD_FILTER_VALUES: readonly AuthMethodFilter[] = [
  "all",
  "email",
  "google",
  "facebook",
  "apple",
] as const;

// "all" = no filter applied. Other values map 1:1 to the values stored on
// UserSubscription.platform. Matching is independent of `isActive` so
// users who originally signed up on iOS/Android/web/admin still appear
// in the right bucket after their subscription expires or is cancelled.
// Users with no subscription at all don't belong to any platform bucket.
type PlatformFilter =
  | "all"
  | "ios"
  | "android"
  | "tvos"
  | "macos"
  | "web"
  | "stripe"
  | "paddle"
  | "admin";

const PLATFORM_FILTER_VALUES: readonly PlatformFilter[] = [
  "all",
  "ios",
  "android",
  "tvos",
  "macos",
  "web",
  "stripe",
  "paddle",
  "admin",
] as const;

type SortColumn =
  | "createdAt"
  | "updatedAt"
  | "plan"
  | "followers"
  | "name"
  | "email"
  | "favorites";
type SortDirection = "asc" | "desc";

// Stable identifiers for every column in the users table. Used as keys in
// the persisted columnWidths map so widths survive column reorders or
// future visibility toggles without getting mis-applied.
const COLUMN_KEYS = [
  "name",
  "email",
  "followers",
  "authMethod",
  "plan",
  "favorites",
  "createdAt",
  "updatedAt",
  "userId",
  "actions",
] as const;
type ColumnKey = (typeof COLUMN_KEYS)[number];

const COLUMN_KEY_SET: ReadonlySet<string> = new Set(COLUMN_KEYS);

// Hard limits so a runaway drag (or a corrupted localStorage value) can
// never make a column unusably narrow or push the table absurdly wide.
const MIN_COLUMN_WIDTH = 60;
const MAX_COLUMN_WIDTH = 800;

interface UsersViewPrefs {
  searchQuery: string;
  planFilter: PlanFilter;
  authMethodFilter: AuthMethodFilter;
  platformFilter: PlatformFilter;
  sort: { column: SortColumn; direction: SortDirection } | null;
  columnWidths: Partial<Record<ColumnKey, number>>;
  limit: number;
}

const DEFAULT_VIEW_PREFS: UsersViewPrefs = {
  searchQuery: "",
  planFilter: "all",
  authMethodFilter: "all",
  platformFilter: "all",
  sort: null,
  columnWidths: {},
  limit: 50,
};

const SORT_COLUMNS: ReadonlyArray<SortColumn> = [
  "createdAt",
  "updatedAt",
  "plan",
  "followers",
  "name",
  "email",
  "favorites",
];

function getNameKey(user: UserProfile): string {
  const name =
    user.fullName ||
    `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
  return name.toLowerCase();
}

function sanitizeViewPrefs(raw: unknown): UsersViewPrefs {
  if (!raw || typeof raw !== "object") return DEFAULT_VIEW_PREFS;
  const obj = raw as Record<string, unknown>;
  const planRaw = obj.planFilter;
  const authRaw = obj.authMethodFilter;
  const platformRaw = obj.platformFilter;
  let sort: UsersViewPrefs["sort"] = null;
  const sortRaw = obj.sort as Record<string, unknown> | undefined;
  if (
    sortRaw &&
    typeof sortRaw === "object" &&
    SORT_COLUMNS.includes(sortRaw.column as SortColumn) &&
    (sortRaw.direction === "asc" || sortRaw.direction === "desc")
  ) {
    sort = {
      column: sortRaw.column as SortColumn,
      direction: sortRaw.direction as SortDirection,
    };
  }
  // Drop unknown column keys and clamp widths so a tampered or stale
  // payload (e.g. one persisted before a column was renamed) can't break
  // the table layout.
  const columnWidths: Partial<Record<ColumnKey, number>> = {};
  const widthsRaw = obj.columnWidths;
  if (widthsRaw && typeof widthsRaw === "object") {
    for (const [k, v] of Object.entries(widthsRaw as Record<string, unknown>)) {
      if (!COLUMN_KEY_SET.has(k)) continue;
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      const clamped = Math.max(
        MIN_COLUMN_WIDTH,
        Math.min(MAX_COLUMN_WIDTH, Math.round(v)),
      );
      columnWidths[k as ColumnKey] = clamped;
    }
  }
  const limitRaw = obj.limit;
  const limit =
    typeof limitRaw === "number" && Number.isFinite(limitRaw)
      ? Math.max(10, Math.min(200, Math.round(limitRaw)))
      : 50;
  return {
    searchQuery: typeof obj.searchQuery === "string" ? obj.searchQuery : "",
    planFilter:
      typeof planRaw === "string" &&
      (PLAN_FILTER_VALUES as readonly string[]).includes(planRaw)
        ? (planRaw as PlanFilter)
        : "all",
    authMethodFilter:
      typeof authRaw === "string" &&
      (AUTH_METHOD_FILTER_VALUES as readonly string[]).includes(authRaw)
        ? (authRaw as AuthMethodFilter)
        : "all",
    platformFilter:
      typeof platformRaw === "string" &&
      (PLATFORM_FILTER_VALUES as readonly string[]).includes(platformRaw)
        ? (platformRaw as PlatformFilter)
        : "all",
    sort,
    columnWidths,
    limit,
  };
}

function matchesPlatformFilter(
  sub: UserSubscription | null | undefined,
  filter: PlatformFilter,
): boolean {
  if (filter === "all") return true;
  // Match purely on the stored platform value so users who originally
  // signed up on iOS/Android/web/admin still show up after their
  // subscription lapses or is cancelled. Users with no subscription
  // (and therefore no platform value) are excluded from every bucket.
  if (!sub) return false;
  return sub.platform === filter;
}

function matchesPlanFilter(
  sub: UserSubscription | null | undefined,
  filter: PlanFilter,
): boolean {
  if (filter === "all") return true;
  const plan = sub?.plan ?? "none";
  const isActive = subscriptionAccess(sub).active;
  if (filter === "none") {
    // Treat inactive/cancelled subs as "no plan" too — matches the table's
    // effective-access calculation, including expired or invalid dates.
    return !isActive || plan === "none";
  }
  if (!isActive) return false;
  if (filter === "any_premium") {
    return (
      plan === "premium_monthly" ||
      plan === "premium_yearly" ||
      plan === "premium_lifetime"
    );
  }
  return plan === filter;
}

function matchesAuthMethodFilter(
  authProvider: string | undefined,
  filter: AuthMethodFilter,
): boolean {
  if (filter === "all") return true;
  // Legacy users (and email/password signups) often have no authProvider set.
  const provider = (authProvider || "email").toLowerCase();
  return provider === filter;
}

// Ordering for the Plan column. Higher rank = more valuable plan, so
// 'desc' surfaces lifetime/premium users first which is what admins
// usually want when scanning. Inactive subscriptions are treated as
// 'none' regardless of the stored plan value.
const PLAN_RANK: Record<string, number> = {
  none: 0,
  remove_ads: 1,
  premium_monthly: 2,
  premium_yearly: 3,
  premium_lifetime: 4,
};

function getPlanRank(user: UserProfile): number {
  const sub = user.subscription;
  if (!sub || !subscriptionAccess(sub).active) return 0;
  return PLAN_RANK[sub.plan] ?? 0;
}

// Simple debounce hook
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDebounced(value), delay);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [value, delay]);
  return debounced;
}

// Indexed PostgreSQL sorts are handled server-side.
const SERVER_SORT_COLUMNS = new Set<SortColumn>(["createdAt", "updatedAt", "name", "email", "followers"]);

export default function AdminUsers() {
  const {
    prefs,
    setPrefs,
    reset: resetViewPrefs,
  } = useAdminViewPrefs<UsersViewPrefs>(
    VIEW_PREFS_KEY,
    DEFAULT_VIEW_PREFS,
    sanitizeViewPrefs,
  );
  const searchQuery = prefs.searchQuery;
  const planFilter = prefs.planFilter;
  const authMethodFilter = prefs.authMethodFilter;
  const platformFilter = prefs.platformFilter;
  const sort = prefs.sort;
  const limitPerPage = prefs.limit;
  // Page resets to 1 whenever any filter/sort changes — not persisted.
  const [page, setPage] = useState(1);
  const resizeCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => resizeCleanup.current?.(), []);
  const debouncedSearch = useDebounce(searchQuery, 350);

  const setSearchQuery = (value: string) => {
    setPage(1);
    setPrefs((p) => ({ ...p, searchQuery: value }));
  };
  const setPlanFilter = (value: PlanFilter) => {
    setPage(1);
    setPrefs((p) => ({ ...p, planFilter: value }));
  };
  const setAuthMethodFilter = (value: AuthMethodFilter) => {
    setPage(1);
    setPrefs((p) => ({ ...p, authMethodFilter: value }));
  };
  const setPlatformFilter = (value: PlatformFilter) => {
    setPage(1);
    setPrefs((p) => ({ ...p, platformFilter: value }));
  };
  const setLimitPerPage = (value: number) => {
    setPage(1);
    setPrefs((p) => ({ ...p, limit: value }));
  };
  const setSort = (next: UsersViewPrefs["sort"]) => {
    // Reset to page 1 only for server-side sorts (page-local sorts don't need it).
    if (!next || SERVER_SORT_COLUMNS.has(next.column)) setPage(1);
    setPrefs((p) => ({ ...p, sort: next }));
  };
  const handleToggleSort = (column: SortColumn) => {
    setSort(
      !sort || sort.column !== column
        ? { column, direction: "desc" }
        : { column, direction: sort.direction === "desc" ? "asc" : "desc" },
    );
  };
  const columnWidths = prefs.columnWidths;
  const hasCustomColumnWidths = Object.keys(columnWidths).length > 0;
  // When a drag starts we snapshot every column's currently-rendered width
  // and switch the table to fixed layout so subsequent drags only move the
  // dragged edge instead of reflowing the whole row.
  const handleColumnResizeStart = useCallback(
    (event: ReactMouseEvent<HTMLSpanElement>, columnKey: ColumnKey) => {
      // Don't let the click bubble up to the sort button beneath the handle.
      event.preventDefault();
      event.stopPropagation();
      if (event.button !== 0) return;
      const handle = event.currentTarget;
      resizeCleanup.current?.();
      const th = handle.closest("th") as HTMLTableCellElement | null;
      if (!th) return;
      const tr = th.parentElement;
      if (!tr) return;
      const measured: Partial<Record<ColumnKey, number>> = {};
      for (const cell of Array.from(tr.children) as HTMLTableCellElement[]) {
        const key = cell.dataset.columnKey;
        if (key && COLUMN_KEY_SET.has(key)) {
          measured[key as ColumnKey] = Math.round(
            cell.getBoundingClientRect().width,
          );
        }
      }
      const startX = event.clientX;
      const startWidth =
        measured[columnKey] ?? Math.round(th.getBoundingClientRect().width);

      // Seed widths for any column the admin hasn't sized yet so the
      // switch to fixed layout doesn't cause a visual jump. Existing
      // user-set widths (in `prev`) win over the freshly-measured ones.
      setPrefs((prev) => ({
        ...prev,
        columnWidths: {
          ...measured,
          ...prev.columnWidths,
          [columnKey]: startWidth,
        },
      }));

      const onMove = (ev: MouseEvent) => {
        const next = Math.max(
          MIN_COLUMN_WIDTH,
          Math.min(
            MAX_COLUMN_WIDTH,
            Math.round(startWidth + (ev.clientX - startX)),
          ),
        );
        setPrefs((prev) => {
          if (prev.columnWidths[columnKey] === next) return prev;
          return {
            ...prev,
            columnWidths: { ...prev.columnWidths, [columnKey]: next },
          };
        });
      };
      const oldCursor = document.body.style.cursor;
      const oldUserSelect = document.body.style.userSelect;
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.cursor = oldCursor;
        document.body.style.userSelect = oldUserSelect;
        resizeCleanup.current = null;
      };
      resizeCleanup.current = onUp;
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [setPrefs],
  );
  const columnStyle = (key: ColumnKey): CSSProperties | undefined => {
    const width = columnWidths[key];
    return width != null ? { width } : undefined;
  };
  const renderResizeHandle = (key: ColumnKey) => (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${key} column`}
      data-testid={`resize-handle-${key}`}
      onMouseDown={(e) => handleColumnResizeStart(e, key)}
      // Swallow the click so it never reaches a sort button under the handle.
      onClick={(e) => e.stopPropagation()}
      className="absolute top-0 right-0 z-10 h-full w-1.5 cursor-col-resize select-none bg-transparent hover:bg-gray-300/60 active:bg-gray-400"
    />
  );
  const hasActiveFilters =
    planFilter !== "all" ||
    authMethodFilter !== "all" ||
    platformFilter !== "all";
  const hasNonDefaultViewPrefs =
    searchQuery.trim() !== "" ||
    hasActiveFilters ||
    sort !== null ||
    hasCustomColumnWidths ||
    limitPerPage !== 50;
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<UserProfile>>({});
  // Local form state for the "Admin Overrides" section in the edit modal.
  // Reset every time the user opens a new edit dialog.
  const [subPlanDraft, setSubPlanDraft] = useState<string>("none");
  const [subExpiresDraft, setSubExpiresDraft] = useState<string>("");
  const [csvExporting, setCsvExporting] = useState(false);
  const { toast } = useToast();

  // Build server-side sort params (plan/favorites are sorted client-side within the loaded page)
  const serverSortBy = sort && SERVER_SORT_COLUMNS.has(sort.column) ? sort.column : "createdAt";
  const serverSortDir = (sort && SERVER_SORT_COLUMNS.has(sort.column)) ? sort.direction : "desc";

  const queryParams = useMemo(() => {
    const p: Record<string, string> = {
      page: String(page),
      limit: String(limitPerPage),
      sortBy: serverSortBy,
      sortDir: serverSortDir,
    };
    if (debouncedSearch.trim()) p.search = debouncedSearch.trim();
    if (planFilter !== "all") p.plan = planFilter;
    if (authMethodFilter !== "all") p.authMethod = authMethodFilter;
    if (platformFilter !== "all") p.platform = platformFilter;
    return p;
  }, [page, limitPerPage, debouncedSearch, planFilter, authMethodFilter, platformFilter, serverSortBy, serverSortDir]);

  const { data: usersResponse, isLoading: isLoadingUsers, isFetching: isFetchingUsers, error: usersError } = useQuery<{ users: UserProfile[]; total: number; totalPages: number }>({
    queryKey: ["/api/admin/users", queryParams],
    staleTime: 30000,
    queryFn: async ({ signal }) => {
      const qs = new URLSearchParams(queryParams).toString();
      const res = await apiRequest("GET", `/api/admin/users?${qs}`, { signal });
      return res.json();
    },
    retry: 2,
  });
  const users = usersResponse?.users || [];
  const totalUsers = usersResponse?.total ?? 0;
  const totalPages = Math.max(1, usersResponse?.totalPages ?? 1);
  useEffect(() => { if (usersResponse && page > totalPages) setPage(totalPages); }, [usersResponse, page, totalPages]);

  // Server handles search/plan/authMethod/platform/most-sorts.
  // Client only sorts by plan or favorites (within the loaded page).
  const filteredUsers = useMemo(() => {
    if (!sort || SERVER_SORT_COLUMNS.has(sort.column)) return users;
    const dir = sort.direction === "asc" ? 1 : -1;
    return [...users].sort((a, b) => {
      let av: number;
      let bv: number;
      if (sort.column === "plan") {
        av = getPlanRank(a); bv = getPlanRank(b);
      } else {
        av = a.favorites || 0; bv = b.favorites || 0;
      }
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return cmp === 0 ? a.email.localeCompare(b.email) : cmp * dir;
    });
  }, [users, sort]);


  const formatCount = (n: number) => n.toLocaleString();

  const renderSortIcon = (column: SortColumn) => {
    if (!sort || sort.column !== column) {
      return (
        <ChevronsUpDown
          className="h-4 w-4 opacity-50 inline-block ml-1"
          data-testid={`icon-sort-${column}-none`}
          aria-hidden="true"
        />
      );
    }
    if (sort.direction === "desc") {
      return (
        <ChevronDown
          className="h-4 w-4 inline-block ml-1"
          data-testid={`icon-sort-${column}-desc`}
          aria-hidden="true"
        />
      );
    }
    return (
      <ChevronUp
        className="h-4 w-4 inline-block ml-1"
        data-testid={`icon-sort-${column}-asc`}
        aria-hidden="true"
      />
    );
  };

  const ariaSortFor = (
    column: SortColumn,
  ): "ascending" | "descending" | "none" => {
    if (!sort || sort.column !== column) return "none";
    return sort.direction === "asc" ? "ascending" : "descending";
  };

  // Shared row builder for the client-side XLSX export. CSV is exported
  // server-side via a streaming endpoint (see `handleDownloadCsv` below),
  // so we don't need a CSV-specific row builder here.
  type ExportRow = {
    id: string;
    name: string;
    email: string;
    auth_method: string;
    plan: string;
    plan_active: boolean;
    expires_at: Date | null;
    followers: number;
    favorites: number;
    created_at: Date | null;
    updated_at: Date | null;
  };

  const parseDate = (s?: string | null): Date | null => {
    if (!s) return null;
    const d = new Date(s);
    return Number.isFinite(d.getTime()) ? d : null;
  };

  const buildExportRows = (): ExportRow[] =>
    filteredUsers.map((u) => {
      const name =
        u.fullName ||
        [u.firstName, u.lastName].filter(Boolean).join(" ") ||
        "";
      const sub = u.subscription;
      return {
        id: u._id,
        name,
        email: u.email,
        auth_method: (u.authProvider || "email").toLowerCase(),
        plan: sub?.plan ?? "none",
        plan_active: subscriptionAccess(sub).active,
        expires_at: parseDate(sub?.expiresAt ?? undefined),
        followers: u.followers ?? 0,
        favorites: u.favorites ?? 0,
        created_at: parseDate(u.createdAt),
        updated_at: parseDate(u.updatedAt),
      };
    });

  // Same naming convention as the CSV export so admins can pair files
  // together when archiving.
  const exportTimestamp = (): string =>
    new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "_")
      .replace("Z", "");

  const handleDownloadXlsx = async () => {
    // exceljs is ~900KB pre-gzip; lazy-load so the rest of the admin UI
    // stays snappy and only admins who actually click "Download Excel"
    // pay the cost.
    let ExcelJS: typeof import("exceljs");
    try {
      ExcelJS = await import("exceljs");
    } catch {
      toast({
        title: "Excel export unavailable",
        description: "Could not load the Excel exporter. Please try CSV instead.",
        variant: "destructive",
      });
      return;
    }
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "MegaRadio Admin";
    workbook.created = new Date();
    const sheet = workbook.addWorksheet("Users");
    sheet.columns = [
      { header: "id", key: "id", width: 26 },
      { header: "name", key: "name", width: 24 },
      { header: "email", key: "email", width: 32 },
      { header: "auth_method", key: "auth_method", width: 14 },
      { header: "plan", key: "plan", width: 18 },
      { header: "plan_active", key: "plan_active", width: 12 },
      // Real Excel date cells so admins can sort/filter by date in Excel.
      { header: "expires_at", key: "expires_at", width: 20, style: { numFmt: "yyyy-mm-dd hh:mm:ss" } },
      { header: "followers", key: "followers", width: 12, style: { numFmt: "0" } },
      { header: "favorites", key: "favorites", width: 12, style: { numFmt: "0" } },
      { header: "created_at", key: "created_at", width: 20, style: { numFmt: "yyyy-mm-dd hh:mm:ss" } },
      { header: "updated_at", key: "updated_at", width: 20, style: { numFmt: "yyyy-mm-dd hh:mm:ss" } },
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    for (const row of buildExportRows()) {
      sheet.addRow(row);
    }
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `megaradio-users-${exportTimestamp()}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Export the full filtered result set through authenticated API transport.
  // Direct navigation cannot attach the bearer fallback or report failures.
  const handleDownloadCsv = async () => {
    if (csvExporting) return;
    const params = new URLSearchParams();
    const trimmed = searchQuery.trim();
    if (trimmed) params.set("search", trimmed);
    if (planFilter !== "all") params.set("plan", planFilter);
    if (authMethodFilter !== "all") params.set("authMethod", authMethodFilter);
    if (platformFilter !== "all") params.set("platform", platformFilter);
    const qs = params.toString();
    setCsvExporting(true);
    try {
      const response = await apiRequest("GET", `/api/admin/users/export.csv${qs ? `?${qs}` : ""}`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `megaradio-users-${exportTimestamp()}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      toast({ title: "CSV export unavailable", description: "The user list could not be downloaded. Please try again.", variant: "destructive" });
    } finally { setCsvExporting(false); }
  };

  const sortableHeaderClass =
    "inline-flex items-center gap-1 px-0 py-1 text-sm font-bold hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm";

  const updateUserMutation = useMutation({
    mutationFn: (data: { userId: string; updates: Partial<UserProfile> }) =>
      apiRequest("PATCH", `/api/admin/users/${data.userId}`, {
        body: data.updates,
      }),
    onSuccess: (_result, saved) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Success", description: "User updated successfully" });
      setEditingUserId(current => current === saved.userId ? null : current);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update user", variant: "destructive" });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: (userId: string) =>
      apiRequest("DELETE", `/api/admin/users/${userId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Success", description: "User deleted successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete user", variant: "destructive" });
    },
  });

  // Admin override: revoke active subscription. Stamps cancelledAt + flips
  // isActive=false but keeps the historical product/txn fields for audit.
  const cancelSubMutation = useMutation({
    mutationFn: (userId: string) =>
      apiRequest("POST", `/api/admin/users/${userId}/subscription/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Subscription cancelled", description: "User's subscription marked inactive." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to cancel subscription", variant: "destructive" });
    },
  });

  // Admin override: grant lifetime premium (platform='admin', expiresAt=null,
  // isActive=true). Used for promo codes, support compensation, etc.
  const grantLifetimeMutation = useMutation({
    mutationFn: (userId: string) =>
      apiRequest("POST", `/api/admin/users/${userId}/subscription/grant-lifetime`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Lifetime granted", description: "User now has premium_lifetime via admin override." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to grant lifetime", variant: "destructive" });
    },
  });

  // Free-form plan/expiry override (existing endpoint). Lets admin pick a
  // plan from the dropdown and (optionally) set a custom expiresAt.
  const updateSubMutation = useMutation({
    mutationFn: (data: { userId: string; plan: string; expiresAt?: string | null }) =>
      apiRequest("PATCH", `/api/admin/users/${data.userId}/subscription`, {
        body: {
          plan: data.plan,
          isActive: data.plan !== "none",
          ...(data.expiresAt !== undefined ? { expiresAt: data.expiresAt } : {}),
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Subscription updated", description: "Plan saved successfully." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update subscription", variant: "destructive" });
    },
  });

  const accountBusy = updateUserMutation.isPending || deleteUserMutation.isPending || cancelSubMutation.isPending || grantLifetimeMutation.isPending || updateSubMutation.isPending;
  const handleSaveEdit = (userId: string) => {
    if (accountBusy) return;
    const fullName = editData.fullName?.trim() || '';
    const email = editData.email?.trim() || '';
    if (!fullName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({ title: "Check user details", description: "Enter a name and a valid email address.", variant: "destructive" });
      return;
    }
    // Do not replay stale subscription, avatar or account status fields while editing name/email.
    updateUserMutation.mutate({ userId, updates: { fullName, email } });
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString();
  };

  const getSubscriptionBadge = (sub?: UserSubscription | null) => {
    const access = subscriptionAccess(sub);
    if (access.status === 'expired') return <Badge className="bg-gray-100 text-gray-700 border text-xs">Expired</Badge>;
    if (access.status === 'invalid_expiry') return <Badge className="bg-amber-100 text-amber-800 border text-xs">Missing or invalid expiry</Badge>;
    if (!sub || !access.active) return null;
    const colors: Record<string, string> = {
      remove_ads: "bg-blue-100 text-blue-800 border-blue-300",
      premium_monthly: "bg-yellow-100 text-yellow-800 border-yellow-300",
      premium_yearly: "bg-orange-100 text-orange-800 border-orange-300",
      premium_lifetime: "bg-purple-100 text-purple-800 border-purple-300",
    };
    const labels: Record<string, string> = {
      remove_ads: "No Ads",
      premium_monthly: "Premium (M)",
      premium_yearly: "Premium (Y)",
      premium_lifetime: "Lifetime",
    };
    const icons: Record<string, string> = {
      remove_ads: "🚫",
      premium_monthly: "⭐",
      premium_yearly: "⭐",
      premium_lifetime: "💎",
    };
    return (
      <Badge className={`${colors[sub.plan] || ''} border text-xs`}>
        {icons[sub.plan] || ''} {labels[sub.plan] || sub.plan}
        {sub.isTrial && " (Trial)"}
      </Badge>
    );
  };

  const getAuthMethodBadge = (authProvider?: string) => {
    const provider = authProvider || "Email";
    const variants: Record<string, string> = {
      "google": "bg-blue-100 text-blue-800",
      "facebook": "bg-purple-100 text-purple-800",
      "apple": "bg-gray-100 text-gray-800",
      "email": "bg-green-100 text-green-800",
    };
    return variants[provider.toLowerCase()] || "bg-gray-100 text-gray-800";
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 sm:py-6 lg:px-8 space-y-5 sm:space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Users Management</h1>
        <p className="text-gray-600 mt-2">View and manage all registered users</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Search Users</CardTitle>
          <CardDescription>
            Search by email or name, and narrow down by subscription plan, sign-in method, or platform
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-64">
              <Search className="absolute left-3 top-3 text-gray-400" size={20} />
              <Input
                data-testid="input-search-users"
                placeholder="Search users..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select
              value={planFilter}
              onValueChange={(value) => setPlanFilter(value as PlanFilter)}
            >
              <SelectTrigger
                className="w-48"
                data-testid="select-plan-filter"
                aria-label="Filter by plan"
              >
                <SelectValue placeholder="Filter by plan" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All plans</SelectItem>
                <SelectItem value="none">No plan</SelectItem>
                <SelectItem value="remove_ads">Remove Ads</SelectItem>
                <SelectItem value="any_premium">Any Premium</SelectItem>
                <SelectItem value="premium_monthly">Premium · Monthly</SelectItem>
                <SelectItem value="premium_yearly">Premium · Yearly</SelectItem>
                <SelectItem value="premium_lifetime">Premium · Lifetime</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={authMethodFilter}
              onValueChange={(value) =>
                setAuthMethodFilter(value as AuthMethodFilter)
              }
            >
              <SelectTrigger
                className="w-48"
                data-testid="select-auth-method-filter"
                aria-label="Filter by auth method"
              >
                <SelectValue placeholder="Filter by auth method" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sign-in methods</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="google">Google</SelectItem>
                <SelectItem value="facebook">Facebook</SelectItem>
                <SelectItem value="apple">Apple</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={platformFilter}
              onValueChange={(value) =>
                setPlatformFilter(value as PlatformFilter)
              }
            >
              <SelectTrigger
                className="w-48"
                data-testid="select-platform-filter"
                aria-label="Filter by subscription platform"
              >
                <SelectValue placeholder="Filter by platform" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All platforms</SelectItem>
                <SelectItem value="ios">iOS</SelectItem>
                <SelectItem value="android">Android</SelectItem>
                <SelectItem value="tvos">tvOS</SelectItem>
                <SelectItem value="macos">macOS</SelectItem>
                <SelectItem value="web">Web</SelectItem>
                <SelectItem value="stripe">Stripe</SelectItem>
                <SelectItem value="paddle">Paddle</SelectItem>
                <SelectItem value="admin">Admin-granted</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={String(limitPerPage)}
              onValueChange={(v) => setLimitPerPage(Number(v))}
            >
              <SelectTrigger className="w-32" aria-label="Rows per page">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="25">25 / page</SelectItem>
                <SelectItem value="50">50 / page</SelectItem>
                <SelectItem value="100">100 / page</SelectItem>
                <SelectItem value="200">200 / page</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              onClick={handleDownloadCsv}
              disabled={totalUsers === 0 || csvExporting || isFetchingUsers || !!usersError}
              data-testid="button-download-users-csv"
              aria-label="Download filtered users as CSV"
              title="Download the currently filtered user list as a CSV file"
              className="bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
            >
              <Download size={16} className="mr-2" />
              {csvExporting ? "Preparing CSV…" : "Download CSV"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleDownloadXlsx}
              disabled={filteredUsers.length === 0 || isFetchingUsers || !!usersError}
              data-testid="button-download-users-xlsx"
              aria-label="Download current page as Excel"
              title="Download this page as Excel; use CSV to export all matching users"
              className="bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
            >
              <Download size={16} className="mr-2" />
              Excel (this page)
            </Button>
            <ResetViewButton
              hasNonDefaultPrefs={hasNonDefaultViewPrefs}
              reset={resetViewPrefs}
              toastDescription="Search, filters, sort, and column widths restored to defaults on this device and your account."
              title="Clear search, filters, sort, and column widths on this device and your account"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {hasActiveFilters || debouncedSearch.trim()
              ? `${formatCount(totalUsers)} users match`
              : `All Users (${formatCount(totalUsers)})`}
          </CardTitle>
          <CardDescription>Manage user profiles, data, and permissions</CardDescription>
        </CardHeader>
        <CardContent>
          {!isLoadingUsers && !usersError && totalUsers > 0 && (
            <p
              className="text-sm text-gray-600 mb-4"
              data-testid="text-users-filter-summary"
            >
              {hasActiveFilters || debouncedSearch.trim() !== "" ? (
                <>
                  Showing{" "}
                  <span className="font-medium text-gray-900">
                    {formatCount((page - 1) * limitPerPage + 1)}–{formatCount(Math.min(page * limitPerPage, totalUsers))}
                  </span>{" "}
                  of <span className="font-medium text-gray-900">{formatCount(totalUsers)}</span> matching users.
                </>
              ) : (
                <>
                  Showing{" "}
                  <span className="font-medium text-gray-900">
                    {formatCount((page - 1) * limitPerPage + 1)}–{formatCount(Math.min(page * limitPerPage, totalUsers))}
                  </span>{" "}
                  of <span className="font-medium text-gray-900">{formatCount(totalUsers)}</span> users.
                </>
              )}
            </p>
          )}
          {isLoadingUsers ? (
            <div className="flex justify-center py-8">
              <Loader2 className="animate-spin" size={32} />
            </div>
          ) : usersError ? (
            <div className="text-center py-8">
              <p className="text-red-600 font-medium mb-2">Failed to load users</p>
              <p className="text-gray-500 text-sm">{(usersError as Error).message}</p>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="text-center py-8 text-gray-500" data-testid="text-empty-users">
              {totalUsers === 0
                ? "No users found"
                : hasActiveFilters && debouncedSearch.trim() !== ""
                  ? "No users match your search and filters. Try clearing a filter or adjusting your search."
                  : hasActiveFilters
                    ? "No users match the selected filters. Try a different plan, sign-in method, or platform."
                    : "No users match your search."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table
                style={
                  hasCustomColumnWidths ? { tableLayout: "fixed" } : undefined
                }
              >
                <TableHeader>
                  <TableRow className="bg-gray-50 hover:bg-gray-50">
                    <TableHead
                      data-column-key="name"
                      style={columnStyle("name")}
                      className="font-bold relative"
                      aria-sort={ariaSortFor("name")}
                    >
                      <button
                        type="button"
                        data-testid="button-sort-name"
                        onClick={() => handleToggleSort("name")}
                        aria-label={
                          sort?.column === "name" && sort.direction === "desc"
                            ? "Sorted by name, Z to A. Click to sort A to Z."
                            : sort?.column === "name" && sort.direction === "asc"
                              ? "Sorted by name, A to Z. Click to sort Z to A."
                              : "Sort by name"
                        }
                        className={sortableHeaderClass}
                      >
                        <span>Name</span>
                        {renderSortIcon("name")}
                      </button>
                      {renderResizeHandle("name")}
                    </TableHead>
                    <TableHead
                      data-column-key="email"
                      style={columnStyle("email")}
                      className="font-bold relative"
                      aria-sort={ariaSortFor("email")}
                    >
                      <button
                        type="button"
                        data-testid="button-sort-email"
                        onClick={() => handleToggleSort("email")}
                        aria-label={
                          sort?.column === "email" && sort.direction === "desc"
                            ? "Sorted by email, Z to A. Click to sort A to Z."
                            : sort?.column === "email" && sort.direction === "asc"
                              ? "Sorted by email, A to Z. Click to sort Z to A."
                              : "Sort by email"
                        }
                        className={sortableHeaderClass}
                      >
                        <span>Email</span>
                        {renderSortIcon("email")}
                      </button>
                      {renderResizeHandle("email")}
                    </TableHead>
                    <TableHead
                      data-column-key="followers"
                      style={columnStyle("followers")}
                      className="font-bold text-center relative"
                      aria-sort={ariaSortFor("followers")}
                    >
                      <button
                        type="button"
                        data-testid="button-sort-followers"
                        onClick={() => handleToggleSort("followers")}
                        aria-label={
                          sort?.column === "followers" && sort.direction === "desc"
                            ? "Sorted by followers, highest first. Click to sort lowest first."
                            : sort?.column === "followers" && sort.direction === "asc"
                              ? "Sorted by followers, lowest first. Click to sort highest first."
                              : "Sort by followers"
                        }
                        className={sortableHeaderClass}
                      >
                        <span>Followers</span>
                        {renderSortIcon("followers")}
                      </button>
                      {renderResizeHandle("followers")}
                    </TableHead>
                    <TableHead
                      data-column-key="authMethod"
                      style={columnStyle("authMethod")}
                      className="font-bold relative"
                    >
                      Auth Method
                      {renderResizeHandle("authMethod")}
                    </TableHead>
                    <TableHead
                      data-column-key="plan"
                      style={columnStyle("plan")}
                      className="font-bold text-center relative"
                      aria-sort={ariaSortFor("plan")}
                    >
                      <button
                        type="button"
                        data-testid="button-sort-plan"
                        onClick={() => handleToggleSort("plan")}
                        aria-label={
                          sort?.column === "plan" && sort.direction === "desc"
                            ? "Sorted by plan, highest tier first. Click to sort lowest tier first."
                            : sort?.column === "plan" && sort.direction === "asc"
                              ? "Sorted by plan, lowest tier first. Click to sort highest tier first."
                              : "Sort by plan"
                        }
                        className={sortableHeaderClass}
                      >
                        <span>Plan</span>
                        {renderSortIcon("plan")}
                      </button>
                      {renderResizeHandle("plan")}
                    </TableHead>
                    <TableHead
                      data-column-key="favorites"
                      style={columnStyle("favorites")}
                      className="font-bold text-center relative"
                      aria-sort={ariaSortFor("favorites")}
                    >
                      <button
                        type="button"
                        data-testid="button-sort-favorites"
                        onClick={() => handleToggleSort("favorites")}
                        aria-label={
                          sort?.column === "favorites" && sort.direction === "desc"
                            ? "Sorted by favorites, highest first. Click to sort lowest first."
                            : sort?.column === "favorites" && sort.direction === "asc"
                              ? "Sorted by favorites, lowest first. Click to sort highest first."
                              : "Sort by favorites"
                        }
                        className={sortableHeaderClass}
                      >
                        <span>Favorites</span>
                        {renderSortIcon("favorites")}
                      </button>
                      {renderResizeHandle("favorites")}
                    </TableHead>
                    <TableHead
                      data-column-key="createdAt"
                      style={columnStyle("createdAt")}
                      className="font-bold relative"
                      aria-sort={ariaSortFor("createdAt")}
                    >
                      <button
                        type="button"
                        data-testid="button-sort-created-at"
                        onClick={() => handleToggleSort("createdAt")}
                        aria-label={
                          sort?.column === "createdAt" && sort.direction === "desc"
                            ? "Sorted by joined date, newest first. Click to sort oldest first."
                            : sort?.column === "createdAt" && sort.direction === "asc"
                              ? "Sorted by joined date, oldest first. Click to sort newest first."
                              : "Sort by joined date"
                        }
                        className={sortableHeaderClass}
                      >
                        <span>Created</span>
                        {renderSortIcon("createdAt")}
                      </button>
                      {renderResizeHandle("createdAt")}
                    </TableHead>
                    <TableHead
                      data-column-key="updatedAt"
                      style={columnStyle("updatedAt")}
                      className="font-bold relative"
                      aria-sort={ariaSortFor("updatedAt")}
                    >
                      <button
                        type="button"
                        data-testid="button-sort-updated-at"
                        onClick={() => handleToggleSort("updatedAt")}
                        aria-label={
                          sort?.column === "updatedAt" && sort.direction === "desc"
                            ? "Sorted by last update, newest first. Click to sort oldest first."
                            : sort?.column === "updatedAt" && sort.direction === "asc"
                              ? "Sorted by last update, oldest first. Click to sort newest first."
                              : "Sort by last update"
                        }
                        className={sortableHeaderClass}
                      >
                        <span>Last Update</span>
                        {renderSortIcon("updatedAt")}
                      </button>
                      {renderResizeHandle("updatedAt")}
                    </TableHead>
                    <TableHead
                      data-column-key="userId"
                      style={columnStyle("userId")}
                      className="font-bold relative"
                    >
                      User ID
                      {renderResizeHandle("userId")}
                    </TableHead>
                    <TableHead
                      data-column-key="actions"
                      style={columnStyle("actions")}
                      className="font-bold text-center relative"
                    >
                      Actions
                      {renderResizeHandle("actions")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((user) => (
                    <TableRow key={user._id} className="hover:bg-gray-50">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <img
                            src={getAvatarUrl(user)}
                            alt={user.fullName || `${user.firstName} ${user.lastName}`}
                            className="w-8 h-8 rounded-full object-cover"
                          />
                          <span className="font-medium">
                            {user.fullName || `${user.firstName} ${user.lastName}`}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{user.email}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="secondary">{user.followers || 0}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={getAuthMethodBadge(user.authProvider)}>
                          {user.authProvider || "Email"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        {getSubscriptionBadge(user.subscription) || (
                          <span className="text-gray-400 text-xs">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline">{user.favorites || 0}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">{formatDate(user.createdAt)}</TableCell>
                      <TableCell className="text-sm">{formatDate(user.updatedAt)}</TableCell>
                      <TableCell className="text-xs text-gray-500 font-mono">
                        {user._id.slice(0, 8)}...
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex gap-2 justify-center">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setEditingUserId(user._id);
                              setEditData(user);
                              setSubPlanDraft(user.subscription?.plan || "none");
                              setSubExpiresDraft(
                                user.subscription?.expiresAt && Number.isFinite(new Date(user.subscription.expiresAt).getTime())
                                  ? new Date(user.subscription.expiresAt).toISOString().slice(0, 10)
                                  : "",
                              );
                            }}
                            title="Edit user"
                            disabled={accountBusy}
                          >
                            <Edit2 size={16} />
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Are you sure you want to delete ${user.firstName} ${user.lastName}?`
                                )
                              ) {
                                deleteUserMutation.mutate(user._id);
                              }
                            }}
                            title="Delete user"
                            disabled={accountBusy}
                          >
                            <Trash2 size={16} />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4 border-t border-gray-100 mt-2">
              <p className="text-sm text-gray-500">
                Page <span className="font-medium">{page}</span> of{" "}
                <span className="font-medium">{totalPages}</span>
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(1)}
                  disabled={page <= 1 || isFetchingUsers}
                  aria-label="First page"
                  className="px-2"
                >
                  «
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || isFetchingUsers}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                {/* Show up to 5 page buttons centered around current page */}
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
                  return start + i;
                }).map((p) => (
                  <Button
                    key={p}
                    variant={p === page ? "default" : "outline"}
                    size="sm"
                    onClick={() => setPage(p)}
                    disabled={isFetchingUsers}
                    className="w-8"
                  >
                    {p}
                  </Button>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages || isFetchingUsers}
                  aria-label="Next page"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(totalPages)}
                  disabled={page >= totalPages || isFetchingUsers}
                  aria-label="Last page"
                  className="px-2"
                >
                  »
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {editingUserId && (() => {
        const editUser = users.find(u => u._id === editingUserId);
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => { if (!accountBusy) setEditingUserId(null); }}>
            <div role="dialog" aria-modal="true" aria-label="Edit user information" className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="bg-white border-b px-6 py-4 rounded-t-lg">
                <h2 className="text-xl font-bold text-gray-900">Edit User Information</h2>
                <p className="text-sm text-gray-500 mt-1">User ID: {editingUserId}</p>
              </div>
              <fieldset disabled={accountBusy} className="bg-white px-6 py-5 space-y-5 min-w-0">
                <div className="flex items-center gap-4 pb-4 border-b border-gray-200">
                  <img
                    src={getAvatarUrl(editUser || editData as UserProfile)}
                    alt="Avatar"
                    className="w-16 h-16 rounded-full object-cover border-2 border-gray-200"
                  />
                  <div>
                    <p className="font-semibold text-gray-900">{editData.fullName || "No name"}</p>
                    <p className="text-sm text-gray-500">{editData.email}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                    <Input
                      aria-label="Full name"
                      value={editData.fullName || ""}
                      onChange={(e) => setEditData({ ...editData, fullName: e.target.value })}
                      placeholder="Full name"
                      className="bg-white text-gray-900 border-gray-300"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                    <Input
                      aria-label="Email"
                      value={editData.email || ""}
                      onChange={(e) => setEditData({ ...editData, email: e.target.value })}
                      placeholder="Email"
                      type="email"
                      className="bg-white text-gray-900 border-gray-300"
                    />
                  </div>
                </div>

                <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">User Details</h3>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-gray-500">Auth Method</span>
                      <p className="font-medium text-gray-900">{editUser?.authProvider || "email"}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Status</span>
                      <p className="font-medium">
                        <span className={editUser?.isActive !== false ? "text-green-600" : "text-red-600"}>
                          {editUser?.isActive !== false ? "Active" : "Inactive"}
                        </span>
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-500">Followers</span>
                      <p className="font-medium text-gray-900">{editUser?.followers || 0}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Favorites</span>
                      <p className="font-medium text-gray-900">{editUser?.favorites || 0}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Created</span>
                      <p className="font-medium text-gray-900">{formatDate(editUser?.createdAt)}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Last Update</span>
                      <p className="font-medium text-gray-900">{formatDate(editUser?.updatedAt)}</p>
                    </div>
                    {editUser?.googleId && (
                      <div className="col-span-2">
                        <span className="text-gray-500">Google ID</span>
                        <p className="font-medium text-gray-900 font-mono text-xs">{editUser.googleId}</p>
                      </div>
                    )}
                    <div className="col-span-2">
                      <span className="text-gray-500">User ID</span>
                      <p className="font-medium text-gray-900 font-mono text-xs">{editingUserId}</p>
                    </div>
                  </div>
                </div>

                {/* Subscription Details — full read-only view of every IUser.subscription field */}
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center justify-between">
                    <span>Subscription Details</span>
                    {getSubscriptionBadge(editUser?.subscription) || (
                      <span className="text-xs text-gray-400 normal-case font-normal">No active plan</span>
                    )}
                  </h3>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-gray-500">Plan</span>
                      <p className="font-medium text-gray-900">{editUser?.subscription?.plan || "none"}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Effective access</span>
                      <p className={`font-medium ${subscriptionAccess(editUser?.subscription).active ? "text-green-700" : "text-red-700"}`}>
                        {subscriptionAccess(editUser?.subscription).active ? "Yes" : "No"}
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-500">Platform</span>
                      <p className="font-medium text-gray-900">{editUser?.subscription?.platform || "-"}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Trial</span>
                      <p className="font-medium text-gray-900">{editUser?.subscription?.isTrial ? "Yes" : "No"}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Started</span>
                      <p className="font-medium text-gray-900">{formatDate(editUser?.subscription?.startedAt)}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Expires</span>
                      <p className="font-medium text-gray-900">
                        {editUser?.subscription?.expiresAt
                          ? formatDate(editUser.subscription.expiresAt)
                          : editUser?.subscription?.plan === "premium_lifetime"
                            ? "Never (lifetime)"
                            : "-"}
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-500">Last verified</span>
                      <p className="font-medium text-gray-900">{formatDate(editUser?.subscription?.lastVerifiedAt)}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Cancelled</span>
                      <p className="font-medium text-gray-900">
                        {editUser?.subscription?.cancelledAt ? formatDate(editUser.subscription.cancelledAt) : "-"}
                      </p>
                    </div>
                    {editUser?.subscription?.productId && (
                      <div className="col-span-2">
                        <span className="text-gray-500">Product ID</span>
                        <p className="font-medium text-gray-900 font-mono text-xs break-all">{editUser.subscription.productId}</p>
                      </div>
                    )}
                    {editUser?.subscription?.originalTransactionId && (
                      <div className="col-span-2">
                        <span className="text-gray-500">Original transaction ID</span>
                        <p className="font-medium text-gray-900 font-mono text-xs break-all">{editUser.subscription.originalTransactionId}</p>
                      </div>
                    )}
                  </div>
                </div>

                {editUser?.subscription?.platform === 'admin' && (
                  <p className="text-xs text-gray-600">This is an admin entitlement, not a verified store purchase. Product and transaction identifiers above are retained billing history and may refer to an earlier plan.</p>
                )}

                {/* Admin Overrides — bypass Apple/Google. Sets platform='admin' on the server. */}
                <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Admin Overrides</h3>
                  <p className="text-xs text-gray-600">
                    These actions bypass Apple/Google verification. The server stamps <code className="bg-white px-1 rounded">platform=admin</code> so the override is auditable.
                  </p>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Plan</label>
                      <select
                        value={subPlanDraft}
                        onChange={(e) => { setSubPlanDraft(e.target.value); if (e.target.value === 'premium_lifetime') setSubExpiresDraft(''); }}
                        className="w-full bg-white text-gray-900 border border-gray-300 rounded px-2 py-1.5 text-sm"
                      >
                        <option value="none">none (no plan)</option>
                        <option value="remove_ads">remove_ads</option>
                        <option value="premium_monthly">premium_monthly</option>
                        <option value="premium_yearly">premium_yearly</option>
                        <option value="premium_lifetime">premium_lifetime</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Expires (required for time-limited plans)</label>
                      <Input
                        type="date"
                        disabled={subPlanDraft === 'premium_lifetime' || subPlanDraft === 'none'}
                        value={subExpiresDraft}
                        onChange={(e) => setSubExpiresDraft(e.target.value)}
                        className="bg-white text-gray-900 border-gray-300 text-sm"
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      size="sm"
                      onClick={() =>
                        updateSubMutation.mutate({
                          userId: editingUserId,
                          plan: subPlanDraft,
                          expiresAt: subExpiresDraft ? new Date(subExpiresDraft).toISOString() : null,
                        })
                      }
                      disabled={accountBusy || !['none', 'premium_lifetime'].includes(subPlanDraft) && (!subExpiresDraft || !isCalendarDate(subExpiresDraft))}
                      className="bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      {updateSubMutation.isPending ? <Loader2 className="mr-1 animate-spin" size={14} /> : null}
                      Save plan
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (window.confirm("Grant lifetime premium to this user (admin override)?")) {
                          grantLifetimeMutation.mutate(editingUserId);
                        }
                      }}
                      disabled={accountBusy}
                      className="bg-white text-purple-700 border-purple-300 hover:bg-purple-50"
                    >
                      <Crown size={14} className="mr-1" />
                      Grant lifetime
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (window.confirm("Cancel this user's subscription? They will lose premium access immediately.")) {
                          cancelSubMutation.mutate(editingUserId);
                        }
                      }}
                      disabled={accountBusy || !subscriptionAccess(editUser?.subscription).active}
                      className="bg-white text-red-700 border-red-300 hover:bg-red-50 disabled:opacity-50"
                    >
                      <Ban size={14} className="mr-1" />
                      Cancel subscription
                    </Button>
                  </div>
                </div>

                <div className="flex gap-2 justify-end pt-4 border-t border-gray-200">
                  <Button
                    variant="outline"
                    onClick={() => setEditingUserId(null)}
                    disabled={accountBusy}
                    className="bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => handleSaveEdit(editingUserId)}
                    disabled={accountBusy}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    {updateUserMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 animate-spin" size={16} />
                        Saving...
                      </>
                    ) : (
                      "Save Changes"
                    )}
                  </Button>
                </div>
              </fieldset>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
