import { notFound } from "next/navigation";
import { db } from "@/server/db/client";
import { formatMoney, formatDate } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, CheckCircle2, Download } from "lucide-react";

interface Props {
  params: Promise<{ code: string }>;
}

const METHOD_LABELS: Record<string, string> = {
  paystack: "Paystack",
  bank_transfer: "Bank Transfer",
  cheque: "Cheque",
  cash: "Cash",
  other: "Other",
};

export default async function PublicReceiptPage({ params }: Props) {
  const { code } = await params;
  const receipt = await db.receipt.findUnique({
    where: { code },
    include: { organization: true, invoice: true },
  });

  if (!receipt) notFound();

  return (
    <div className="max-w-2xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between border-b pb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-brand-600 text-white">
              <Building2 className="h-6 w-6" />
            </div>
            <div>
              <CardTitle className="text-2xl">Receipt {receipt.code}</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">Ethree10</p>
            </div>
          </div>
          <Badge variant="default" className="text-lg py-1 px-4">PAID</Badge>
        </CardHeader>
        <CardContent className="pt-8 space-y-8">
          <div className="rounded-lg border-l-4 border-lime-500 bg-muted/50 px-5 py-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Amount Paid</p>
              <p className="text-3xl font-bold">{formatMoney(Number(receipt.amount), receipt.currency)}</p>
            </div>
            <CheckCircle2 className="h-8 w-8 text-success-600" />
          </div>

          <dl className="divide-y">
            <div className="flex justify-between py-3">
              <dt className="text-muted-foreground">Paid By</dt>
              <dd className="font-medium">{receipt.organization.name}</dd>
            </div>
            <div className="flex justify-between py-3">
              <dt className="text-muted-foreground">Payment Method</dt>
              <dd className="font-medium">{METHOD_LABELS[receipt.paymentMethod] ?? receipt.paymentMethod}</dd>
            </div>
            <div className="flex justify-between py-3">
              <dt className="text-muted-foreground">Payment Reference</dt>
              <dd className="font-medium">{receipt.paymentRef ?? "—"}</dd>
            </div>
            {receipt.invoice ? (
              <div className="flex justify-between py-3">
                <dt className="text-muted-foreground">For Invoice</dt>
                <dd className="font-medium">
                  <a href={`/invoice/${receipt.invoice.code}`} className="text-brand-700 hover:underline">
                    {receipt.invoice.code}
                  </a>
                </dd>
              </div>
            ) : null}
            <div className="flex justify-between py-3">
              <dt className="text-muted-foreground">Date Paid</dt>
              <dd className="font-medium">{formatDate(receipt.issuedAt)}</dd>
            </div>
          </dl>

          {receipt.pdfUrl ? (
            <div className="border-t pt-6">
              <a href={receipt.pdfUrl} target="_blank" rel="noreferrer" className="inline-flex items-center text-brand-700 hover:underline">
                <Download className="mr-1.5 h-4 w-4" /> Download receipt PDF
              </a>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
