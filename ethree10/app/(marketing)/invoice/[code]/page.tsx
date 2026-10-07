import { notFound } from "next/navigation";
import { toDataURL } from "qrcode";
import { db } from "@/server/db/client";
import { formatMoney } from "@/lib/format";
import { invoicePublicUrl } from "@/server/services/invoice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, CheckCircle2, Download, ReceiptText } from "lucide-react";

interface Props {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ error?: string }>;
}

const PAY_ERRORS: Record<string, string> = {
  "email-required": "Please enter your email to pay.",
  "currency-unsupported": "Online payment is only available for NGN invoices.",
  "payment-init-failed": "We couldn't start the payment. Please try again.",
};

export default async function PublicInvoicePage({ params, searchParams }: Props) {
  const { code } = await params;
  const { error } = await searchParams;
  const invoice = await db.invoice.findUnique({
    where: { code },
    include: { organization: true, project: true, receipt: true },
  });

  if (!invoice) notFound();

  const lineItems = invoice.lineItems as Array<{
    description: string;
    quantity: number;
    unitPrice: number;
  }>;

  const isPaid = invoice.status === "paid";
  const qrDataUrl = await toDataURL(invoicePublicUrl(invoice.code), { margin: 1, width: 160 });
  const payError = error ? PAY_ERRORS[error] : undefined;

  return (
    <div className="max-w-4xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between border-b pb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-brand-600 text-white">
              <Building2 className="h-6 w-6" />
            </div>
            <div>
              <CardTitle className="text-2xl">Invoice {invoice.code}</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">Ethree10</p>
            </div>
          </div>
          <div className="text-right">
            <Badge variant={isPaid ? "default" : "secondary"} className="text-lg py-1 px-4">
              {invoice.status.toUpperCase()}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-8 space-y-8">
          <div className="grid grid-cols-2 gap-8">
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">Billed To</h3>
              <p className="font-medium text-lg">{invoice.organization.name}</p>
            </div>
            <div className="text-right">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">Amount Due</h3>
              <p className="text-3xl font-bold">{formatMoney(Number(invoice.amount), invoice.currency)}</p>
            </div>
          </div>

          <div>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b-2">
                  <th className="py-3 font-semibold text-muted-foreground">Description</th>
                  <th className="py-3 font-semibold text-muted-foreground text-right">Qty</th>
                  <th className="py-3 font-semibold text-muted-foreground text-right">Unit Price</th>
                  <th className="py-3 font-semibold text-muted-foreground text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {lineItems.map((item, i) => (
                  <tr key={i}>
                    <td className="py-4">{item.description}</td>
                    <td className="py-4 text-right">{item.quantity}</td>
                    <td className="py-4 text-right">{formatMoney(item.unitPrice, invoice.currency)}</td>
                    <td className="py-4 text-right font-medium">
                      {formatMoney(item.quantity * item.unitPrice, invoice.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border-t pt-8 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} alt={`QR code for invoice ${invoice.code}`} className="h-24 w-24" />
              <div className="flex flex-col gap-2 text-sm">
                {invoice.pdfUrl ? (
                  <a href={invoice.pdfUrl} target="_blank" rel="noreferrer" className="inline-flex items-center text-brand-700 hover:underline">
                    <Download className="mr-1.5 h-4 w-4" /> Download invoice PDF
                  </a>
                ) : null}
                {isPaid && invoice.receipt?.pdfUrl ? (
                  <a href={invoice.receipt.pdfUrl} target="_blank" rel="noreferrer" className="inline-flex items-center text-brand-700 hover:underline">
                    <ReceiptText className="mr-1.5 h-4 w-4" /> Download receipt {invoice.receipt.code}
                  </a>
                ) : null}
              </div>
            </div>

            <div className="sm:text-right">
              {!isPaid ? (
                <form method="get" action={`/api/invoices/${invoice.code}/pay`} className="flex flex-col gap-2 sm:items-end">
                  {payError ? <p className="text-sm text-destructive">{payError}</p> : null}
                  <Input
                    type="email"
                    name="email"
                    required
                    placeholder="you@example.com"
                    className="w-full sm:w-64"
                  />
                  <Button size="lg" type="submit" className="w-full sm:w-auto">
                    Pay with Paystack
                  </Button>
                </form>
              ) : (
                <div className="flex items-center text-success-600 font-medium text-lg">
                  <CheckCircle2 className="mr-2 h-6 w-6" />
                  Paid on {invoice.paidAt?.toLocaleDateString()}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
