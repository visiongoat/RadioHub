import { AdminPage } from "./AdminPage";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useAdminPriceVerification } from "@/hooks/use-admin-price-verification";
import { formatAdminMoney as formatAmount } from "@/lib/admin-account-utils";
import { Loader2, CheckCircle, XCircle, ExternalLink, Zap, Search } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface PlanRecord {
  planId: string;
  paddlePriceId?: string;
  label: string;
  description: string;
  isActive: boolean;
  updatedAt: string;
}

const PLAN_LABELS: Record<string, string> = {
  remove_ads:       "Remove Ads",
  premium_monthly:  "Monthly",
  premium_quarterly: "Quarterly",
  premium_yearly:   "Annual",
  premium_lifetime: "Lifetime",
};

const PLAN_MODE: Record<string, string> = {
  remove_ads:       "ad-free access",
  premium_monthly:  "subscription",
  premium_quarterly: "subscription",
  premium_yearly:   "subscription",
  premium_lifetime: "one-time payment",
};

const ENV_VAR: Record<string, string> = {
  remove_ads:       "PADDLE_PRICE_REMOVE_ADS",
  premium_monthly:  "PADDLE_PRICE_MONTHLY",
  premium_quarterly: "PADDLE_PRICE_QUARTERLY",
  premium_yearly:   "PADDLE_PRICE_ANNUAL",
  premium_lifetime: "PADDLE_PRICE_LIFETIME",
};

interface VerifyResult {
  valid: boolean;
  currency?: string;
  unitAmount?: number;
  billingCycle?: { interval: string; frequency: number } | null;
  active?: boolean;
  name?: string | null;
  error?: string;
}

function PlanCard({ plan }: { plan: PlanRecord }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ paddlePriceId: plan.paddlePriceId ?? "" });
  const { verifying, result: verifyResult, reset: resetVerification, verify } = useAdminPriceVerification<VerifyResult>("/api/admin/stripe-plans/verify-paddle-price");
  const resetDraft = (editing: boolean) => {
    resetVerification();
    setForm({ paddlePriceId: plan.paddlePriceId ?? "" });
    setEditing(editing);
  };
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const saveMutation = useMutation({
    mutationFn: async ({ priceId, verification }: { priceId: string; verification: VerifyResult | null }) => {
      const body: Record<string, unknown> = { paddlePriceId: priceId.trim() };
      // Include amount + currency from Paddle when verified, so /premium shows real prices
      if (verification?.valid && typeof verification.unitAmount === "number" && verification.currency) {
        body.amount = verification.unitAmount;
        body.currency = verification.currency.toLowerCase();
      }
      const res = await apiRequest("PUT", `/api/admin/stripe-plans/${plan.planId}`, { body });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stripe-plans"] });
      setEditing(false);
      toast({ title: "Saved", description: `${PLAN_LABELS[plan.planId] ?? plan.planId} Paddle price ID saved` });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save", variant: "destructive" });
    },
  });

  const handleVerify = () => verify(form.paddlePriceId);

  return (
    <Card className="border border-gray-200">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Zap className="w-5 h-5 text-blue-500" />
            <div>
              <CardTitle className="text-base">{PLAN_LABELS[plan.planId] || plan.planId}</CardTitle>
              <CardDescription className="text-xs">{plan.planId} · {PLAN_MODE[plan.planId]}</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {plan.isActive ? (
              <Badge className="bg-green-100 text-green-700">Active</Badge>
            ) : (
              <Badge variant="secondary">Inactive</Badge>
            )}
            <Button variant="outline" size="sm" disabled={saveMutation.isPending} onClick={() => resetDraft(!editing)}>
              {editing ? "Cancel" : "Edit"}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {!editing ? (
          <div className="space-y-2 text-sm">
            <div>
              <p className="text-gray-500 text-xs mb-0.5">Paddle Price ID</p>
              <div className="flex items-center gap-2">
                <code className="text-xs bg-blue-50 px-2 py-1 rounded font-mono">
                  {plan.paddlePriceId || <span className="text-gray-400">not set</span>}
                </code>
                {plan.paddlePriceId && (
                  <a
                    href="https://vendors.paddle.com/prices"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-500 hover:text-blue-700"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
              <p className="text-gray-400 text-xs mt-0.5">
                Railway fallback: <code className="bg-gray-100 px-1 rounded">{ENV_VAR[plan.planId]}</code>
              </p>
            </div>
          </div>
        ) : (
          <fieldset className="space-y-4" disabled={saveMutation.isPending}>
            <div className="space-y-1">
              <Label className="text-xs">Paddle Price ID</Label>
              <div className="flex gap-2">
                <Input
                  aria-label="Paddle Price ID"
                  value={form.paddlePriceId}
                  onChange={e => { resetVerification(); setForm({ paddlePriceId: e.target.value }); }}
                  placeholder="pri_xxx"
                  className="font-mono text-sm"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleVerify}
                  disabled={verifying || !form.paddlePriceId}
                  className="flex-shrink-0"
                >
                  {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  Verify
                </Button>
              </div>
              {verifyResult && (
                <div className={`flex items-start gap-2 text-xs mt-1 p-2 rounded ${verifyResult.valid ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                  {verifyResult.valid
                    ? <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    : <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />}
                  {verifyResult.valid ? (
                    <span>
                      Valid
                      {typeof verifyResult.unitAmount === "number" && verifyResult.currency
                        ? ` · ${formatAmount(verifyResult.unitAmount, verifyResult.currency)} ${verifyResult.currency.toUpperCase()}`
                        : ""}
                      {verifyResult.billingCycle
                        ? ` / ${verifyResult.billingCycle.interval}`
                        : " (one-time)"}
                      {verifyResult.name ? ` — "${verifyResult.name}"` : ""}
                      {!verifyResult.active ? " · ⚠️ inactive in Paddle" : ""}
                    </span>
                  ) : (
                    <span>{verifyResult.error || "Price ID not found in Paddle"}</span>
                  )}
                </div>
              )}
              <p className="text-xs text-gray-400 mt-1">
                Railway fallback: <code className="bg-gray-100 px-1 rounded">{ENV_VAR[plan.planId]}</code>
              </p>
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                className="bg-blue-600 hover:bg-blue-700 text-white"
                size="sm"
                onClick={() => saveMutation.mutate({ priceId: form.paddlePriceId, verification: verifyResult })}
                disabled={saveMutation.isPending || verifying}
              >
                {saveMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Save
              </Button>
              <Button variant="outline" size="sm" onClick={() => resetDraft(false)}>
                Cancel
              </Button>
            </div>
          </fieldset>
        )}
      </CardContent>
    </Card>
  );
}

const DEFAULT_PLANS: PlanRecord[] = [
  { planId: "remove_ads",       label: "Remove Ads", description: "Ad-free listening, no premium extras", isActive: true, paddlePriceId: "", updatedAt: "" },
  { planId: "premium_monthly",  label: "Monthly",    description: "Billed monthly, cancel anytime",       isActive: true, paddlePriceId: "", updatedAt: "" },
  { planId: "premium_quarterly", label: "Quarterly", description: "Billed every 3 months, cancel anytime", isActive: true, paddlePriceId: "", updatedAt: "" },
  { planId: "premium_yearly",   label: "Annual",     description: "Best value — save vs monthly",         isActive: true, paddlePriceId: "", updatedAt: "" },
  { planId: "premium_lifetime", label: "Lifetime",   description: "One-time payment, never pay again",    isActive: true, paddlePriceId: "", updatedAt: "" },
];

export default function PaddlePlansPage() {
  const { data, isLoading, isError, isFetching, refetch } = useQuery<{ plans: any[] }>({
    queryKey: ["/api/admin/stripe-plans"],
  });

  const planMap = new Map((data?.plans || []).map((p: any) => [p.planId, p]));
  const plans: PlanRecord[] = DEFAULT_PLANS.map(def => {
    const db = planMap.get(def.planId);
    if (!db) return def;
    return {
      planId: db.planId,
      label: db.label ?? def.label,
      description: db.description ?? def.description,
      isActive: db.isActive ?? def.isActive,
      paddlePriceId: db.paddlePriceId ?? "",
      updatedAt: db.updatedAt ?? "",
    };
  });

  return (
    <AdminPage
      title="Paddle Plans"
      description={<>Manage Paddle price IDs for the TV/Web subscription flow. These apply when <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm">PAYMENT_PROVIDER=paddle</code> is set in Railway.</>}
    >

      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="pt-4 text-sm text-blue-800 space-y-1">
          <p><strong>How it works:</strong></p>
          <p>1. Create prices in your <a href="https://vendors.paddle.com/prices" target="_blank" rel="noopener noreferrer" className="underline">Paddle dashboard</a> (Catalog → Prices)</p>
          <p>2. Paste each <code className="bg-blue-100 px-1 rounded">pri_xxx</code> ID below and click <strong>Verify</strong></p>
          <p>3. Save · Then set <code className="bg-blue-100 px-1 rounded">PAYMENT_PROVIDER=paddle</code> in Railway to go live</p>
          <p className="text-blue-600 text-xs mt-2">
            Webhook URL: <code className="bg-blue-100 px-1 rounded">https://api.themegaradio.com/api/webhooks/paddle</code> · Event: <code className="bg-blue-100 px-1 rounded">transaction.completed</code>
          </p>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      ) : isError ? (
        <div role="alert" className="rounded border border-red-200 p-4 text-sm">Could not load payment plans. Editing is unavailable until the saved settings can be read. <Button variant="outline" size="sm" disabled={isFetching} onClick={() => refetch()}>Retry</Button></div>
      ) : (
        <div className="space-y-4">
          {plans.map(plan => (
            <PlanCard key={plan.planId} plan={plan} />
          ))}
        </div>
      )}
    </AdminPage>
  );
}
