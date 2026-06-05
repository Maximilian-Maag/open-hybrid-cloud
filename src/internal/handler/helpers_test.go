package handler_test

import (
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
	"testing"
)

// newClient returns an HTTP client that persists cookies and follows redirects.
func newClient(t *testing.T) *http.Client {
	t.Helper()
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	return &http.Client{
		Jar: jar,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return nil
		},
	}
}

// login POSTs credentials to /login and fails the test if authentication does not succeed.
func login(t *testing.T, client *http.Client, email, password string) {
	t.Helper()
	resp, err := client.PostForm(testServer.URL+"/login", url.Values{
		"email":    {email},
		"password": {password},
	})
	if err != nil {
		t.Fatalf("login POST: %v", err)
	}
	resp.Body.Close()
	// After a successful login the server redirects to /, which the client follows (200).
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("login as %s: expected 200 after redirect, got %d", email, resp.StatusCode)
	}
}

// get performs a GET request and returns the response. The body is pre-read and closed.
func get(t *testing.T, client *http.Client, path string) (statusCode int, body string) {
	t.Helper()
	resp, err := client.Get(testServer.URL + path)
	if err != nil {
		t.Fatalf("GET %s: %v", path, err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(b)
}

// post performs a POST request with form values and returns the response status code.
func post(t *testing.T, client *http.Client, path string, values url.Values) int {
	t.Helper()
	resp, err := client.PostForm(testServer.URL+path, values)
	if err != nil {
		t.Fatalf("POST %s: %v", path, err)
	}
	resp.Body.Close()
	return resp.StatusCode
}

// assertStatus fails the test if the actual status code does not match the expected one.
func assertStatus(t *testing.T, want, got int) {
	t.Helper()
	if got != want {
		t.Errorf("status: want %d, got %d", want, got)
	}
}

// assertContains fails the test if body does not contain the expected substring.
func assertContains(t *testing.T, body, substr string) {
	t.Helper()
	if !strings.Contains(body, substr) {
		t.Errorf("body does not contain %q", substr)
	}
}
