# Kubernetes Pod → Database Pod Example

A complete working example of a **Node.js app pod** connecting to a **PostgreSQL database pod** inside Kubernetes.

```
app-demo namespace
┌──────────────────────────────────────────────────┐
│                                                  │
│  ┌─────────────┐        ClusterIP Service        │
│  │  nodeapp    │ ──────► postgres-service:5432   │
│  │  Pod (x2)   │              │                  │
│  └─────────────┘              ▼                  │
│   LoadBalancer Svc     ┌─────────────┐           │
│   port 80 ──────────►  │  postgres   │           │
│                         │  Pod (x1)  │           │
│                         └─────────────┘          │
│                               │                  │
│                         PersistentVolume          │
└──────────────────────────────────────────────────┘
```

## Files

```
.
├── app/
│   ├── Dockerfile        # Multi-stage Docker build
│   ├── index.js          # Express + pg REST API
│   └── package.json
└── k8s/
    ├── namespace.yaml            # Namespace: app-demo
    ├── postgres-secret.yaml      # Base64-encoded credentials
    ├── postgres-pvc.yaml         # 1 Gi PersistentVolumeClaim
    ├── postgres-deployment.yaml  # Postgres Deployment + ClusterIP Service
    └── app-deployment.yaml       # App Deployment + LoadBalancer Service
```

## Quick Start

### 1. Build and push the app image

```bash
cd app
docker build -t sravangcpdocker/nodeapp:latest .
docker push sravangcpdocker/nodeapp:latest
```

> Update the `image:` field in [`k8s/app-deployment.yaml`](k8s/app-deployment.yaml) to match.

### 2. (Optional) Change credentials

Default credentials encoded in [`k8s/postgres-secret.yaml`](k8s/postgres-secret.yaml):

| Key               | Plaintext           |
|-------------------|---------------------|
| POSTGRES_USER     | postgres            |
| POSTGRES_PASSWORD | postgrespassword    |
| POSTGRES_DB       | appdb               |

Re-encode with:
```bash
echo -n "mynewpassword" | base64
```

### 3. Apply all manifests

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/postgres-secret.yaml
kubectl apply -f k8s/postgres-pvc.yaml
kubectl apply -f k8s/postgres-deployment.yaml
timeout /t 20 /nobreak >nul
kubectl apply -f k8s/app-deployment.yaml
```

Or apply the whole directory at once:
```bash
kubectl apply -f k8s/
```

### 4. Verify pods are running

```bash
kubectl get all -n app-demo
```

Wait until all pods show `Running` and `READY`.

### 5. Test the API

```bash
# Get the external IP (LoadBalancer) or use port-forward for local testing
kubectl port-forward svc/app-service 8080:80 -n app-demo

# Health check
curl http://localhost:8080/health

# Create a message
curl -X POST http://localhost:8080/messages \
  -H "Content-Type: application/json" \
  -d '{"content": "Hello from the app pod!"}'

# List all messages
curl http://localhost:8080/messages

# Delete a message (replace 1 with the actual id)
curl -X DELETE http://localhost:8080/messages/1
```

## How Pod-to-Pod Communication Works

Kubernetes automatically creates a **DNS record** for every Service:

```
<service-name>.<namespace>.svc.cluster.local
```

The app pod connects to PostgreSQL using the hostname `postgres-service`, which resolves to the **ClusterIP** of the `postgres-service` Service. The Service then forwards traffic to whichever PostgreSQL pod matches the selector `app: postgres`.

The app pod **never references the database pod's IP directly** — it uses the stable Service hostname, which is injected as the `DB_HOST` environment variable.

## Init Container

The app Deployment includes an **init container** (`wait-for-postgres`) that uses `nc` (netcat) to poll `postgres-service:5432` until the database is accepting connections. The main app container only starts after the init container exits successfully.

## Teardown

```bash
kubectl delete -f k8s/
```
