import { AdminPage } from "./AdminPage";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Loader2, CheckCircle, XCircle, ExternalLink, CreditCard, Search } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAdminPriceVerification } from "@/hooks/use-admin-price-verification";
import { formatAdminMoney as formatAmount } from "@/lib/admin-account-utils";

interface StripePlan {
  planId: string;
  stripePriceId: string;
  label: string;
  description: string;
  currency: string;
  amount: number;
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
  remove_ads:       "subscription",
  premium_monthly:  "subscription",
  premium_quarterly: "subscription",
  premium_yearly:   "subscription",
  premium_lifetime: "one-time payment",
};

const ENV_VAR: Record<string, string> = {
  remove_ads:       "STRIPE_PRICE_REMOVE_ADS",
  premium_monthly:  "STRIPE_PRICE_MONTHLY",
  premium_quarterly: "STRIPE_PRICE_QUARTERLY",
  premium_yearly:   "STRIPE_PRICE_ANNUAL",
  premium_lifetime: "STRIPE_PRICE_LIFETIME",
};

interface VerifyResult {
  valid: boolean;
  currency?: string;
  unitAmount?: number;
  recurring?: { interval: string; interval_count: number } | null;
  active?: boolean;
  nickname?: string | null;
  error?: string;
}

function PlanCard({ plan }: { plan: StripePlan }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    stripePriceId: plan.stripePriceId,
    label: plan.label,
    description: plan.description,
    currency: plan.currency,
    amount: plan.amount,
    isActive: plan.isActive,
  });
  const { verifying, result: verifyResult, reset: resetVerification, verify } = useAdminPriceVerification<VerifyResult>("/api/admin/stripe-plans/verify-price");
  const resetDraft = (editing: boolean) => {
    resetVerification();
    setForm({ stripePriceId: plan.stripePriceId, label: plan.label, description: plan.description, currency: plan.currency, amount: plan.amount, isActive: plan.isActive });
    setEditing(editing);
  };
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const saveMutation = useMutation({
    mutationFn: async (submitted: typeof form) => {
      const res = await apiRequest("PUT", `/api/admin/stripe-plans/${plan.planId}`, {
        body: submitted,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stripe-plans"] });
      setEditing(false);
      toast({ title: "Saved", description: `${plan.planId} updated successfully` });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save plan", variant: "destructive" });
    },
  });

  async function handleVerify() {
    await verify(form.stripePriceId, (data) => {
      if (data.valid && typeof data.unitAmount === "number" && data.currency) {
        setForm(f => ({
          ...f,
          amount: data.unitAmount ?? f.amount,
          currency: data.currency ?? f.currency,
        }));
      }
    });
  }

  return (
    <Card className="border border-gray-200">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CreditCard className="w-5 h-5 text-[#FF6B35]" />
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
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-gray-500 text-xs mb-0.5">Label shown to users</p>
              <p className="font-medium">{plan.label}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs mb-0.5">Price</p>
              <p className="font-medium">{formatAmount(plan.amount, plan.currency)}</p>
            </div>
            <div className="col-span-2">
              <p className="text-gray-500 text-xs mb-0.5">Description</p>
              <p>{plan.description}</p>
            </div>
            <div className="col-span-2">
              <p className="text-gray-500 text-xs mb-0.5">Stripe Price ID</p>
              <div className="flex items-center gap-2">
                <code className="text-xs bg-gray-100 px-2 py-1 rounded font-mono">
                  {plan.stripePriceId || <span className="text-gray-400">not set</span>}
                </code>
                {plan.stripePriceId && (
                  <a
                    href={`https://dashboard.stripe.com/prices/${plan.stripePriceId}`}
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
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Label (shown to users)</Label>
                <Input
                  value={form.label}
                  onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                  placeholder="e.g. Monthly"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Currency (3-letter code)</Label>
                <Input
                  value={form.currency}
                  onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}
                  placeholder="usd / try / eur"
                  maxLength={3}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Description</Label>
              <Input
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="e.g. Billed monthly, cancel anytime"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Stripe Price ID</Label>
              <div className="flex gap-2">
                <Input
                  aria-label="Stripe Price ID"
                  value={form.stripePriceId}
                  onChange={e => { resetVerification(); setForm(f => ({ ...f, stripePriceId: e.target.value })); }}
                  placeholder="price_xxx"
                  className="font-mono text-sm"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleVerify}
                  disabled={verifying || !form.stripePriceId}
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
                      Valid · {formatAmount(verifyResult.unitAmount ?? 0, verifyResult.currency ?? "usd")} {verifyResult.currency?.toUpperCase()}
                      {verifyResult.recurring ? ` / ${verifyResult.recurring.interval}` : " (one-time)"}
                      {verifyResult.nickname ? ` — "${verifyResult.nickname}"` : ""}
                      {" · amount & currency auto-filled"}
                    </span>
                  ) : (
                    <span>{verifyResult.error || "Price ID not found in Stripe"}</span>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Amount (in smallest unit, e.g. cents)</Label>
              <Input
                type="number"
                min={0}
                step={1}
                aria-label="Amount in smallest currency unit"
                value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: parseInt(e.target.value) || 0 }))}
                placeholder="499 = $4.99"
              />
              <p className="text-xs text-gray-400">Auto-filled when you verify the Stripe price ID above</p>
            </div>

            <div className="flex items-center gap-3">
              <Switch
                checked={form.isActive}
                onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))}
              />
              <Label className="text-sm">Active (shown to users)</Label>
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                className="bg-[#FF6B35] hover:bg-[#e55a24] text-white"
                size="sm"
                onClick={() => saveMutation.mutate({ ...form })}
                disabled={saveMutation.isPending || verifying || !Number.isSafeInteger(form.amount) || form.amount < 0 || !/^[a-z]{3}$/i.test(form.currency.trim())}
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

const DEFAULT_PLANS: StripePlan[] = [
  { planId: "remove_ads",       label: "Remove Ads", description: "Ad-free listening, no premium extras", currency: "usd", amount: 0, isActive: true, stripePriceId: "", updatedAt: "" },
  { planId: "premium_monthly",  label: "Monthly",    description: "Billed monthly, cancel anytime",       currency: "usd", amount: 0, isActive: true, stripePriceId: "", updatedAt: "" },
  { planId: "premium_quarterly", label: "Quarterly", description: "Billed every 3 months, cancel anytime", currency: "eur", amount: 0, isActive: true, stripePriceId: "", updatedAt: "" },
  { planId: "premium_yearly",   label: "Annual",     description: "Best value — save vs monthly",         currency: "usd", amount: 0, isActive: true, stripePriceId: "", updatedAt: "" },
  { planId: "premium_lifetime", label: "Lifetime",   description: "One-time payment, never pay again",    currency: "usd", amount: 0, isActive: true, stripePriceId: "", updatedAt: "" },
];

export default function StripePlansPage() {
  const { data, isLoading, isError, isFetching, refetch } = useQuery<{ plans: StripePlan[] }>({
    queryKey: ["/api/admin/stripe-plans"],
  });

  const planMap = new Map((data?.plans || []).map(p => [p.planId, p]));
  const plans = DEFAULT_PLANS.map(def => planMap.get(def.planId) ?? def);

  return (
    <AdminPage
      title="Stripe Plans"
      description="Manage Stripe price IDs for the TV/Web subscription flow. These apply to Samsung TV, LG TV, and web — not iOS/Android (those use App Store IAP)."
    >

      <Card className="border-purple-200 bg-purple-50">
        <CardContent className="pt-4 text-sm text-purple-800 space-y-1">
          <p><strong>How it works:</strong></p>
          <p>1. Create prices in your <a href="https://dashboard.stripe.com/prices" target="_blank" rel="noopener noreferrer" className="underline">Stripe dashboard</a></p>
          <p>2. Paste each <code className="bg-purple-100 px-1 rounded">price_xxx</code> ID below and click <strong>Verify</strong> — amount & currency auto-fill</p>
          <p>3. Save · Active when <code className="bg-purple-100 px-1 rounded">PAYMENT_PROVIDER=stripe</code> (default)</p>
          <p className="text-purple-600 text-xs mt-2">To switch to Paddle, see Settings → Payment Gateway → Paddle</p>
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
