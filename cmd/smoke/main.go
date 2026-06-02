package main

import (
    "context"
    "fmt"
    "os"

    "github.com/jackc/pgx/v5/pgxpool"
)

func main() {
    dbURL := os.Getenv("DATABASE_URL")
    if dbURL == "" {
        dbURL = "postgres://postgres:postgres@localhost:5432/infrawebshop?sslmode=disable"
    }
    ctx := context.Background()
    pool, err := pgxpool.New(ctx, dbURL)
    if err != nil {
        fmt.Fprintf(os.Stderr, "connect failed: %v\n", err)
        os.Exit(2)
    }
    defer pool.Close()

    var categoryID, gitlabID, userID, projectID, envID, productID, orderID, infraID int64

    if err := pool.QueryRow(ctx, `INSERT INTO categories(name) VALUES('smoke-cat') RETURNING id`).Scan(&categoryID); err != nil {
        fmt.Fprintf(os.Stderr, "insert category failed: %v\n", err)
        os.Exit(2)
    }
    if err := pool.QueryRow(ctx, `INSERT INTO gitlab_sources(name,url,access_token) VALUES('smoke', 'https://example', 't') RETURNING id`).Scan(&gitlabID); err != nil {
        fmt.Fprintf(os.Stderr, "insert gitlab failed: %v\n", err)
        os.Exit(2)
    }
    if err := pool.QueryRow(ctx, `INSERT INTO users(email,name,role,password_hash) VALUES('smoke@example','Smoke','admin','x') RETURNING id`).Scan(&userID); err != nil {
        fmt.Fprintf(os.Stderr, "insert user failed: %v\n", err)
        os.Exit(2)
    }
    if err := pool.QueryRow(ctx, `INSERT INTO projects(name,owner_id) VALUES('smoke-project',$1) RETURNING id`, userID).Scan(&projectID); err != nil {
        fmt.Fprintf(os.Stderr, "insert project failed: %v\n", err)
        os.Exit(2)
    }
    if err := pool.QueryRow(ctx, `INSERT INTO deployment_environments(name,gitlab_source_id,webhook_url,webhook_token) VALUES('smoke-env',$1,'u','t') RETURNING id`, gitlabID).Scan(&envID); err != nil {
        fmt.Fprintf(os.Stderr, "insert env failed: %v\n", err)
        os.Exit(2)
    }
    if err := pool.QueryRow(ctx, `INSERT INTO products(category_id,base_language) VALUES($1,'de') RETURNING id`, categoryID).Scan(&productID); err != nil {
        fmt.Fprintf(os.Stderr, "insert product failed: %v\n", err)
        os.Exit(2)
    }
    if err := pool.QueryRow(ctx, `INSERT INTO orders(project_id,product_id,environment_id,user_id,parameters) VALUES($1,$2,$3,$4,'{}') RETURNING id`, projectID, productID, envID, userID).Scan(&orderID); err != nil {
        fmt.Fprintf(os.Stderr, "insert order failed: %v\n", err)
        os.Exit(2)
    }
    if err := pool.QueryRow(ctx, `INSERT INTO infrastructure_elements(order_id,project_id,environment_id,product_id,parameters) VALUES($1,$2,$3,$4,'{}') RETURNING id`, orderID, projectID, envID, productID).Scan(&infraID); err != nil {
        fmt.Fprintf(os.Stderr, "insert infra failed: %v\n", err)
        os.Exit(2)
    }

    fmt.Println("Inserted IDs:")
    fmt.Println(" category", categoryID)
    fmt.Println(" gitlab", gitlabID)
    fmt.Println(" user", userID)
    fmt.Println(" project", projectID)
    fmt.Println(" env", envID)
    fmt.Println(" product", productID)
    fmt.Println(" order", orderID)
    fmt.Println(" infra", infraID)

    if _, err := pool.Exec(ctx, `DELETE FROM products WHERE id=$1`, productID); err != nil {
        fmt.Fprintf(os.Stderr, "delete product failed: %v\n", err)
        os.Exit(2)
    }
    fmt.Println("Deleted product", productID)

    var cnt int64
    if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM orders WHERE id=$1`, orderID).Scan(&cnt); err != nil {
        fmt.Fprintf(os.Stderr, "check order failed: %v\n", err)
        os.Exit(2)
    }
    fmt.Println("orders remaining with id:", cnt)
    if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM infrastructure_elements WHERE id=$1`, infraID).Scan(&cnt); err != nil {
        fmt.Fprintf(os.Stderr, "check infra failed: %v\n", err)
        os.Exit(2)
    }
    fmt.Println("infrastructure_elements remaining with id:", cnt)

    _, _ = pool.Exec(ctx, `DELETE FROM deployment_environments WHERE id=$1`, envID)
    _, _ = pool.Exec(ctx, `DELETE FROM projects WHERE id=$1`, projectID)
    _, _ = pool.Exec(ctx, `DELETE FROM users WHERE id=$1`, userID)
    _, _ = pool.Exec(ctx, `DELETE FROM gitlab_sources WHERE id=$1`, gitlabID)
    _, _ = pool.Exec(ctx, `DELETE FROM categories WHERE id=$1`, categoryID)

    fmt.Println("Cleanup done")
}
