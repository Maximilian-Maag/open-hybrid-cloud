# Admin Guide

## Overview

As an Admin you can:
- Order infrastructure directly (no approval step required)
- Approve or reject orders from project leaders
- View all projects, orders, and infrastructure elements
- Decommission infrastructure
- View the audit log

---

## 1. Login

1. Open your browser and navigate to the webshop URL
2. Click **Sign in with Microsoft**
3. Complete the Microsoft Entra ID login with your corporate account credentials
4. On first login: confirm consent for the application

---

## 2. Product Catalog

### 2.1 Browsing Products

- Products are organized by category
- Prices are shown in the display currency of your browser locale
- The detail view shows: description, available environments, price per environment, parameters

### 2.2 Placing an Order

1. Select a product in the catalog → click **Configure**
2. Choose the **deployment environment** (e.g. "AWS Frankfurt", "On-Premises Vienna")
3. Select or create a **project**
4. Fill in the parameters (fields are pre-populated when default values are defined)
5. Assign a **cost center** (depending on the product configuration: project / select / overhead)
6. Review the order → click **Deploy Now**

As an Admin the GitLab webhook is triggered **immediately** — no approval step.

### 2.3 Using an Existing Project as a Template

1. Open an existing project under **Infrastructure**
2. Click **Use as Template**
3. The order form opens with pre-filled parameters
4. Adjust parameters as needed and place the order

---

## 3. Approving Orders

Incoming orders from project leaders appear under **Approvals**.

### 3.1 Approving an Order

1. Open an order under **Approvals → Open**
2. Review the order details: product, environment, parameters, project, cost center
3. Click **Approve**
4. The GitLab provisioning webhook is triggered immediately
5. The project leader receives a confirmation email

### 3.2 Rejecting an Order

1. Open an order under **Approvals → Open**
2. Click **Reject**
3. Enter a **rejection reason** — required, delivered to the project leader by email
4. Confirm

---

## 4. Tracking Order Status

Under **Orders**:

- Overview of all orders (own and others')
- Status per order: Pending Approval / Approved / Provisioning / Completed / Failed / Rejected
- Detail view shows live status of the GitLab pipeline (auto-updated)
- On failure: pipeline log link to the GitLab instance

---

## 5. Infrastructure Overview

Under **Infrastructure**:

- All deployed infrastructure elements across all projects and environments
- Grouped by project and deployment environment
- Per element: product, parameters, status, price, cost center, order date, ordered by

### 5.1 Decommissioning Infrastructure

1. Select an infrastructure element in the overview
2. Click **Decommission**
3. Confirm in the dialog
4. The GitLab destroy webhook is triggered — OpenTofu tears down the infrastructure
5. Status is set to **Decommissioning** and updated via polling
6. The original orderer receives a notification upon completion

---

## 6. Managing Projects

Under **Projects**:

- All projects of all users are visible
- Create new projects (name, description, cost center)
- Edit existing projects
- Change the cost center of a project

---

## 7. Audit Log

Under **Audit Log**:

- Complete compliance record: orders, approvals, rejections, deployments, decommissions
- Filterable by time range, user, action type, project
- Export as **CSV** or **PDF**

---

## 8. Email Notifications

As an Admin you automatically receive emails for:

| Event | Description |
|-------|-------------|
| New order (from project leader) | Approval request with link to the order |
| Deployment failed | Error details and link to the pipeline |
