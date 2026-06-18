# Docker Management

Manage Docker containers, images, volumes, networks, and Compose stacks using standard Docker CLI.

## When to Use

- Run, stop, restart, remove, or inspect containers
- Build, pull, push, tag, or clean up Docker images
- Work with Docker Compose (multi-service stacks)
- Manage volumes or networks
- Debug crashing containers or analyze logs
- Check disk usage or free up space
- Review or optimize a Dockerfile

## Quick Reference

```bash
# Container lifecycle
docker run -d --name web -p 8080:80 nginx
docker ps -a
docker stop NAME && docker rm NAME
docker logs --tail 50 -f NAME
docker exec -it NAME /bin/sh
docker inspect NAME

# Build
docker build -t my-app:latest .
docker build --no-cache -t my-app .

# Compose
docker compose up -d
docker compose down
docker compose logs -f api
docker compose exec api /bin/sh

# Cleanup
docker system df                              # disk usage
docker container prune                        # stopped containers
docker image prune                            # dangling images
docker volume prune                           # unused volumes
docker system prune -a --volumes              # EVERYTHING — confirm first!
```

## Key Patterns

```bash
# Resource limits + restart policy
docker run -d --memory=512m --cpus=1.5 --restart=unless-stopped --name app my-app

# With persistent volume
docker run -d -v pgdata:/var/lib/postgresql/data --name db postgres:16

# Interactive debug (auto-remove)
docker run -it --rm ubuntu:22.04 /bin/bash
```

## Verification

- `docker ps` — status "Up"
- `docker logs --tail 20 NAME` — no errors
- `curl -s http://localhost:PORT` — port accessible
- `docker compose ps` — all services "running" or "healthy"

## Dockerfile Tips

1. Multi-stage builds to reduce image size
2. Put dependencies before source code (cache layering)
3. Combine RUN commands (fewer layers)
4. Use `.dockerignore` (exclude node_modules, .git, __pycache__)
5. Pin base image versions (not `:latest`)
6. Run as non-root with `USER` instruction
7. Use slim/alpine bases
