"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { PushToggle } from "@/components/settings/push-toggle";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { Loader2 } from "lucide-react";

// Types from schema
type NotificationKind = 
  | "request_submitted"
  | "request_assigned"
  | "request_state_changed"
  | "task_assigned"
  | "task_due_soon"
  | "task_overdue"
  | "task_completed"
  | "mention"
  | "proposal_sent"
  | "proposal_accepted"
  | "report_ready"
  | "approval_requested"
  | "integration_degraded"
  | "csat_received";

const KIND_LABELS: Record<NotificationKind, string> = {
  request_submitted: "New Request Submitted",
  request_assigned: "Request Assigned to Me",
  request_state_changed: "Request Status Changed",
  task_assigned: "Task Assigned to Me",
  task_due_soon: "Task Due Soon",
  task_overdue: "Task Overdue",
  task_completed: "Task Completed",
  mention: "Mentioned in Comment",
  proposal_sent: "Proposal Sent",
  proposal_accepted: "Proposal Accepted",
  report_ready: "Report Generated",
  approval_requested: "Approval Requested",
  integration_degraded: "Integration Degraded",
  csat_received: "CSAT Feedback Received",
};

export default function NotificationSettingsPage() {
  const { toast } = useToast();
  
  // Queries
  const { data: user } = trpc.auth.me.useQuery();
  const { data: prefs, refetch: refetchPrefs } = trpc.preferences.list.useQuery();
  
  // Mutations
  const updatePref = trpc.preferences.update.useMutation({
    onSuccess: () => refetchPrefs(),
  });
  const sendVerification = trpc.whatsapp.sendVerification.useMutation({
    onSuccess: () => {
      setStep("verify");
      toast({ title: "OTP Sent", description: "Check your WhatsApp for the code." });
    },
    onError: (err: { message: string }) => {
      toast({ variant: "destructive", title: "Error", description: err.message });
    }
  });
  const verifyCode = trpc.whatsapp.verifyCode.useMutation({
    onSuccess: () => {
      setStep("verified");
      toast({ title: "Verified", description: "WhatsApp number verified successfully." });
    },
    onError: (err: { message: string }) => {
      toast({ variant: "destructive", title: "Error", description: err.message });
    }
  });

  // State
  const [phone, setPhone] = useState(user?.phone || "");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "verify" | "verified">(
    user?.phoneVerifiedAt ? "verified" : "phone"
  );

  const getPref = (kind: NotificationKind) => {
    return prefs?.find((p) => p.kind === kind);
  };

  const handleToggle = (kind: NotificationKind, channel: "email" | "push" | "whatsapp", value: boolean) => {
    const current = getPref(kind);
    updatePref.mutate({
      kind,
      email: channel === "email" ? value : (current?.email ?? true),
      push: channel === "push" ? value : (current?.push ?? true),
      whatsapp: channel === "whatsapp" ? value : (current?.whatsapp ?? false),
    });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Notification Settings</h1>
        <p className="text-muted-foreground mt-2">
          Manage how and where you receive notifications.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Push notifications</CardTitle>
        </CardHeader>
        <CardContent>
          <PushToggle />
        </CardContent>
      </Card>

      {/* WhatsApp Setup Card */}
      <Card>
        <CardHeader>
          <CardTitle>WhatsApp Verification</CardTitle>
        </CardHeader>
        <CardContent>
          {step === "phone" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Enter your phone number (with country code, e.g., +234...) to enable WhatsApp notifications.
              </p>
              <div className="flex items-center gap-4">
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+2348000000000"
                  className="max-w-xs"
                />
                <Button 
                  onClick={() => sendVerification.mutate({ phone })}
                  disabled={!phone || sendVerification.isPending}
                >
                  {sendVerification.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Send Code
                </Button>
              </div>
            </div>
          )}

          {step === "verify" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Enter the 6-digit code sent to {phone}.
              </p>
              <div className="flex items-center gap-4">
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="123456"
                  className="max-w-xs"
                />
                <Button 
                  onClick={() => verifyCode.mutate({ code })}
                  disabled={!code || verifyCode.isPending}
                >
                  {verifyCode.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Verify
                </Button>
                <Button variant="ghost" onClick={() => setStep("phone")}>
                  Change Number
                </Button>
              </div>
            </div>
          )}

          {step === "verified" && (
            <div className="flex items-center gap-4 text-green-600 font-medium">
              ✅ WhatsApp notifications are enabled for {user?.phone || phone}.
              <Button variant="outline" size="sm" onClick={() => setStep("phone")}>
                Change Number
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Preferences Grid */}
      <Card>
        <CardHeader>
          <CardTitle>Preferences</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <div className="grid grid-cols-4 border-b bg-muted/50 p-4 font-medium">
              <div>Event</div>
              <div className="text-center">Email</div>
              <div className="text-center">In-App</div>
              <div className="text-center">WhatsApp</div>
            </div>
            
            <div className="divide-y">
              {(Object.keys(KIND_LABELS) as NotificationKind[]).map((kind) => {
                const pref = getPref(kind);
                return (
                  <div key={kind} className="grid grid-cols-4 items-center p-4">
                    <div className="font-medium text-sm">{KIND_LABELS[kind]}</div>
                    <div className="flex justify-center">
                      <Switch
                        checked={pref?.email ?? true}
                        onCheckedChange={(val) => handleToggle(kind, "email", val)}
                      />
                    </div>
                    <div className="flex justify-center">
                      <Switch
                        checked={pref?.push ?? true}
                        onCheckedChange={(val) => handleToggle(kind, "push", val)}
                      />
                    </div>
                    <div className="flex justify-center">
                      <Switch
                        checked={pref?.whatsapp ?? false}
                        disabled={step !== "verified"}
                        onCheckedChange={(val) => handleToggle(kind, "whatsapp", val)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
