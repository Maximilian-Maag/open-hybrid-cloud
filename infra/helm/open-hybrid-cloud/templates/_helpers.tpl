{{/*
Expand the name of the chart.
*/}}
{{- define "open-hybrid-cloud.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified base name.
*/}}
{{- define "open-hybrid-cloud.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Fully qualified name for the frontend component.
*/}}
{{- define "open-hybrid-cloud.frontend.fullname" -}}
{{- printf "%s-frontend" (include "open-hybrid-cloud.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Fully qualified name for the backend component.
*/}}
{{- define "open-hybrid-cloud.backend.fullname" -}}
{{- printf "%s-backend" (include "open-hybrid-cloud.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create chart label value.
*/}}
{{- define "open-hybrid-cloud.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels.
*/}}
{{- define "open-hybrid-cloud.labels" -}}
helm.sh/chart: {{ include "open-hybrid-cloud.chart" . }}
{{ include "open-hybrid-cloud.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels (base — without component).
*/}}
{{- define "open-hybrid-cloud.selectorLabels" -}}
app.kubernetes.io/name: {{ include "open-hybrid-cloud.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Frontend selector labels.
*/}}
{{- define "open-hybrid-cloud.frontend.selectorLabels" -}}
app.kubernetes.io/name: {{ include "open-hybrid-cloud.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: frontend
{{- end }}

{{/*
Backend selector labels.
*/}}
{{- define "open-hybrid-cloud.backend.selectorLabels" -}}
app.kubernetes.io/name: {{ include "open-hybrid-cloud.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: backend
{{- end }}

{{/*
Frontend image reference.
*/}}
{{- define "open-hybrid-cloud.frontend.image" -}}
{{- $tag := .Values.frontend.image.tag | default .Chart.AppVersion }}
{{- printf "%s:%s" .Values.frontend.image.repository $tag }}
{{- end }}

{{/*
Backend image reference.
*/}}
{{- define "open-hybrid-cloud.backend.image" -}}
{{- $tag := .Values.backend.image.tag | default .Chart.AppVersion }}
{{- printf "%s:%s" .Values.backend.image.repository $tag }}
{{- end }}
