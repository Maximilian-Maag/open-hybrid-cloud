package gitlab

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
)

type Client struct {
	BaseURL    string
	Token      string
	httpClient *http.Client
}

type Project struct {
	ID                int64  `json:"id"`
	Name              string `json:"name"`
	PathWithNamespace string `json:"path_with_namespace"`
	DefaultBranch     string `json:"default_branch"`
}

type Branch struct {
	Name    string `json:"name"`
	Default bool   `json:"default"`
}

type TreeEntry struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Type string `json:"type"` // "blob" or "tree"
	Path string `json:"path"`
}

func NewClient(baseURL, token string) *Client {
	return &Client{BaseURL: baseURL, Token: token, httpClient: &http.Client{}}
}

// get performs an authenticated GET request and decodes the JSON response into dst.
func (c *Client) get(ctx context.Context, path string, query url.Values, dst any) error {
	u := c.BaseURL + "/api/v4" + path
	if len(query) > 0 {
		u += "?" + query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	if c.Token != "" {
		req.Header.Set("PRIVATE-TOKEN", c.Token)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("gitlab GET %s: %w", path, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return fmt.Errorf("gitlab %s: status %d: %s", path, resp.StatusCode, string(body))
	}
	return json.Unmarshal(body, dst)
}

// ListProjects returns projects accessible to the token. Pass search="" for all.
func (c *Client) ListProjects(ctx context.Context, search string) ([]Project, error) {
	q := url.Values{"membership": {"true"}, "per_page": {"100"}}
	if search != "" {
		q.Set("search", search)
	}
	var projects []Project
	return projects, c.get(ctx, "/projects", q, &projects)
}

// ListBranches returns all branches for a project.
func (c *Client) ListBranches(ctx context.Context, projectID int64) ([]Branch, error) {
	var branches []Branch
	return branches, c.get(ctx, "/projects/"+strconv.FormatInt(projectID, 10)+"/repository/branches",
		url.Values{"per_page": {"100"}}, &branches)
}

// ListFiles returns the file tree at a path within a repo at a given ref.
func (c *Client) ListFiles(ctx context.Context, projectID int64, ref, path string) ([]TreeEntry, error) {
	q := url.Values{"ref": {ref}, "per_page": {"100"}}
	if path != "" {
		q.Set("path", path)
	}
	var entries []TreeEntry
	return entries, c.get(ctx, "/projects/"+strconv.FormatInt(projectID, 10)+"/repository/tree", q, &entries)
}

// Pipeline represents a GitLab CI pipeline with its status.
type Pipeline struct {
	ID     int64  `json:"id"`
	Status string `json:"status"` // pending, running, success, failed, canceled, skipped
}

// GetPipelineStatus returns the current status of a pipeline.
func (c *Client) GetPipelineStatus(ctx context.Context, projectID, pipelineID int64) (*Pipeline, error) {
	path := fmt.Sprintf("/projects/%d/pipelines/%d", projectID, pipelineID)
	var p Pipeline
	return &p, c.get(ctx, path, nil, &p)
}

// GetFile returns the raw content of a file at a given path and ref.
func (c *Client) GetFile(ctx context.Context, projectID int64, ref, filePath string) ([]byte, error) {
	encodedPath := url.PathEscape(filePath)
	u := c.BaseURL + "/api/v4/projects/" + strconv.FormatInt(projectID, 10) +
		"/repository/files/" + encodedPath + "/raw?ref=" + url.QueryEscape(ref)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	if c.Token != "" {
		req.Header.Set("PRIVATE-TOKEN", c.Token)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("gitlab file %s: status %d: %s", filePath, resp.StatusCode, body)
	}
	return io.ReadAll(resp.Body)
}
