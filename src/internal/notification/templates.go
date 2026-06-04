package notification

const (
	subjectOrderCreated        = "Order #%d placed — awaiting approval"
	subjectOrderCreatedDirect  = "Order #%d placed — provisioning started"
	subjectAdminApprovalNeeded = "New order #%d requires your approval"
	subjectOrderApproved       = "Order #%d approved — provisioning started"
	subjectOrderRejected       = "Order #%d rejected"
	subjectProvisioningDone    = "Order #%d provisioned successfully"
	subjectProvisioningFailed  = "Order #%d provisioning failed"
	subjectDecommissioned      = "Infrastructure #%d decommissioned"
	subjectProvFailedAdmin     = "Order #%d provisioning failed — action required"
)

const orderCreatedOrdTmpl = `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
<h2>Order Placed</h2>
<p>Your order <strong>#{{.OrderID}}</strong> has been placed and is awaiting approval.</p>
<table style="border-collapse:collapse;width:100%">
<tr><td style="padding:6px 0;color:#666">Product:</td><td>{{.ProductName}}</td></tr>
<tr><td style="padding:6px 0;color:#666">Environment:</td><td>{{.EnvName}}</td></tr>
</table>
<p style="color:#666;font-size:12px;margin-top:30px">You will be notified once the order is approved or rejected.</p>
</body></html>`

const orderCreatedDirectTmpl = `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
<h2>Order Placed</h2>
<p>Your order <strong>#{{.OrderID}}</strong> has been placed and provisioning has started.</p>
<table style="border-collapse:collapse;width:100%">
<tr><td style="padding:6px 0;color:#666">Product:</td><td>{{.ProductName}}</td></tr>
<tr><td style="padding:6px 0;color:#666">Environment:</td><td>{{.EnvName}}</td></tr>
</table>
<p style="color:#666;font-size:12px;margin-top:30px">You will be notified once provisioning completes.</p>
</body></html>`

const adminApprovalTmpl = `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
<h2>Approval Required</h2>
<p>A new order requires your approval.</p>
<table style="border-collapse:collapse;width:100%">
<tr><td style="padding:6px 0;color:#666">Order:</td><td><strong>#{{.OrderID}}</strong></td></tr>
<tr><td style="padding:6px 0;color:#666">Ordered by:</td><td>{{.OrdEmail}}</td></tr>
<tr><td style="padding:6px 0;color:#666">Product:</td><td>{{.ProductName}}</td></tr>
<tr><td style="padding:6px 0;color:#666">Environment:</td><td>{{.EnvName}}</td></tr>
</table>
<p>Please log in to the webshop to approve or reject this order.</p>
</body></html>`

const orderApprovedTmpl = `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
<h2>Order Approved</h2>
<p>Your order <strong>#{{.OrderID}}</strong> has been approved and provisioning has started.</p>
<table style="border-collapse:collapse;width:100%">
<tr><td style="padding:6px 0;color:#666">Product:</td><td>{{.ProductName}}</td></tr>
<tr><td style="padding:6px 0;color:#666">Environment:</td><td>{{.EnvName}}</td></tr>
</table>
<p style="color:#666;font-size:12px;margin-top:30px">You will be notified once provisioning completes.</p>
</body></html>`

const orderRejectedTmpl = `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
<h2>Order Rejected</h2>
<p>Your order <strong>#{{.OrderID}}</strong> has been rejected.</p>
<table style="border-collapse:collapse;width:100%">
<tr><td style="padding:6px 0;color:#666">Product:</td><td>{{.ProductName}}</td></tr>
<tr><td style="padding:6px 0;color:#666">Environment:</td><td>{{.EnvName}}</td></tr>
<tr><td style="padding:6px 0;color:#666">Reason:</td><td style="color:#c0392b">{{.Note}}</td></tr>
</table>
</body></html>`

const provisioningDoneTmpl = `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
<h2 style="color:#27ae60">Provisioning Completed</h2>
<p>Your order <strong>#{{.OrderID}}</strong> has been provisioned successfully.</p>
<table style="border-collapse:collapse;width:100%">
<tr><td style="padding:6px 0;color:#666">Product:</td><td>{{.ProductName}}</td></tr>
<tr><td style="padding:6px 0;color:#666">Environment:</td><td>{{.EnvName}}</td></tr>
</table>
</body></html>`

const provisioningFailedTmpl = `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
<h2 style="color:#e74c3c">Provisioning Failed</h2>
<p>Provisioning for order <strong>#{{.OrderID}}</strong> has failed.</p>
<table style="border-collapse:collapse;width:100%">
<tr><td style="padding:6px 0;color:#666">Product:</td><td>{{.ProductName}}</td></tr>
<tr><td style="padding:6px 0;color:#666">Environment:</td><td>{{.EnvName}}</td></tr>
</table>
<p style="color:#666;font-size:12px;margin-top:20px">Please check the GitLab pipeline for details.</p>
</body></html>`

const decommissionedTmpl = `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
<h2>Decommissioning Completed</h2>
<p>Infrastructure element <strong>#{{.ElementID}}</strong> has been decommissioned successfully.</p>
</body></html>`
