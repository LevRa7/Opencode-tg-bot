# Design: Tenant Isolation for /open Command

## Metadata
- **Date**: 2026-04-22
- **Author**: AI Agent
- **Status**: Approved
- **Related Issue**: Fix /open command to show isolated container directories per user instead of host directories for all users

## Context

The Telegram bot command `/open` provides a file browser for selecting project directories. Currently it uses global root directories configured via `OPEN_BROWSER_ROOTS` environment variable or the host home directory, which exposes the same directories to all users.

In a multi-tenant architecture, each user should have an isolated workspace inside their container at path `/home/me/Workspaces/{tenantId}/workspace`. The command needs to be modified to show only the current user's workspace when they have a tenant runtime, maintaining backward compatibility for users without tenant runtime (global server).

## Requirements

1. **Per-user isolation**: Each user with a tenant runtime should see only their own workspace directory
2. **Backward compatibility**: Users without tenant runtime should see global roots (current behavior)
3. **Security**: Users cannot navigate outside their allowed roots (tenant workspace or global roots)
4. **Minimal changes**: Preserve existing API and behavior where possible

## Design Decisions

### Approach: New `getTenantBrowserRoots()` function

We'll create a new function `getTenantBrowserRoots()` in `src/bot/utils/browser-roots.ts` that returns tenant-specific roots for the current user, falling back to global roots when no tenant runtime exists.

This approach was chosen because:
- Minimal impact on existing code
- Clear separation between global and tenant-aware behavior
- Preserves existing `getBrowserRoots()` for other use cases
- Explicit about tenant awareness at call sites

### Tenant Workspace Path Construction

The tenant workspace path is constructed using the same logic as `resolveTenantPathResolver` in `src/bot/index.ts`:
```
${WORKSPACES_ROOT}/${tenantId}/workspace
```

Where:
- `WORKSPACES_ROOT`: Environment variable, defaults to `/home/me/Workspaces`
- `tenantId`: From `TenantRuntimeInfo` for the current user

### Security Boundary

New tenant-aware security check functions will be created:
- `isWithinAllowedTenantRoot(targetPath)`: Checks if path is within tenant workspace
- `isAllowedTenantRoot(targetPath)`: Checks if path is exactly the tenant workspace root

These will be used in `/open` command handlers instead of the global versions.

## Architecture

### Components

1. **`getTenantBrowserRoots()`** (`src/bot/utils/browser-roots.ts`)
   - Gets current Telegram conversation scope
   - Retrieves `TenantRuntimeInfo` for the user
   - Constructs workspace path if tenant exists
   - Falls back to `getBrowserRoots()` for global roots

2. **Tenant-aware security checks** (`src/bot/utils/browser-roots.ts`)
   - `isWithinAllowedTenantRoot(targetPath)`
   - `isAllowedTenantRoot(targetPath)`

3. **Updated `/open` command** (`src/bot/commands/open.ts`)
   - Uses `getTenantBrowserRoots()` instead of `getBrowserRoots()`
   - Uses tenant-aware security checks
   - Maintains same UI/UX

4. **Path resolution utility** (optional refactor)
   - Extract workspace path construction from `resolveTenantPathResolver` to shared utility

### Data Flow

```
User sends /open
    ↓
Bot extracts Telegram scope (userId, chatId)
    ↓
Check for tenant runtime via getTenantRuntimeInfo(userId)
    ↓
If tenant exists:
    Build workspace path: ${WORKSPACES_ROOT}/${tenantId}/workspace
    ↓
    Show file browser rooted at workspace
Else:
    Use global roots via getBrowserRoots()
    ↓
    Show file browser rooted at global directories
```

### Security Model

- Navigation is restricted to the tenant workspace (or global roots)
- All path validation uses tenant-aware checks
- Users cannot traverse outside their isolated directory
- Symlinks are resolved before validation (using `realpath` where needed)

## Implementation Plan

### Phase 1: Core Tenant-Aware Functions

1. Add `getTenantBrowserRoots()` to `browser-roots.ts`
2. Add `isWithinAllowedTenantRoot()` and `isAllowedTenantRoot()`
3. Update exports

### Phase 2: Update `/open` Command

1. Import new functions in `open.ts`
2. Replace `getBrowserRoots()` calls with `getTenantBrowserRoots()`
3. Replace security check calls with tenant-aware versions
4. Update tests

### Phase 3: Testing

1. Unit tests for new functions
2. Integration tests for `/open` with tenant runtime
3. Security tests for path traversal attempts
4. Backward compatibility tests

### Phase 4: Refinement (Optional)

1. Extract shared path construction logic
2. Add logging for tenant workspace resolution
3. Validate workspace directory existence

## Error Handling

- **Missing tenant runtime**: Fall back to global roots (backward compatibility)
- **Missing tenantId**: Log warning, fall back to global roots
- **Workspace doesn't exist**: `scanDirectory` will return error shown to user
- **Permission denied**: Show access denied message
- **Network/IO errors**: Log and show user-friendly error

## Testing Strategy

### Unit Tests
- `getTenantBrowserRoots()` with mocked scope and runtime
- Tenant-aware security checks with various path scenarios
- Fallback behavior when no tenant runtime

### Integration Tests
- `/open` command with tenant runtime (mocked file system)
- `/open` command without tenant runtime (global roots)
- Navigation within tenant workspace
- Attempted path traversal outside workspace

### Security Tests
- Symlink resolution
- Relative path attacks
- Directory traversal attempts

## Dependencies

- `WORKSPACES_ROOT` environment variable (optional, defaults to `/home/me/Workspaces`)
- Tenant runtime must be properly configured with `tenantId`
- Existing `getCurrentTelegramConversationScope()` and `getTenantRuntimeInfo()` functions

## Risks

1. **Path construction errors**: If `WORKSPACES_ROOT` or `tenantId` contain unexpected characters
   - Mitigation: Use `path.join()` for safe construction
2. **Performance impact**: Additional runtime lookups for each `/open` command
   - Mitigation: Minimal overhead (in-memory lookups)
3. **Testing complexity**: Need to mock tenant runtime environment
   - Mitigation: Use existing test patterns from `process/manager.test.ts`

## Success Metrics

- Users with tenant runtime see only their workspace
- Users without tenant runtime see global roots (unchanged behavior)
- No security regressions in path validation
- All existing tests pass
- Command response time unchanged

## Alternatives Considered

### 1. Modify `getBrowserRoots()` to be tenant-aware
- Pros: Single function, all checks automatically tenant-aware
- Cons: Breaking change for other consumers, complex conditional logic

### 2. Parameterized `getBrowserRoots(userId)`
- Pros: Explicit control, easy testing
- Cons: Requires changes to all call sites, more invasive

### 3. Tenant-specific configuration
- Pros: Flexible per-user root configuration
- Cons: Complex configuration management, over-engineering

## Implementation Notes

- Follow existing code patterns in `browser-roots.ts`
- Use same logging format as rest of module (`[BrowserRoots]`)
- Preserve existing function signatures where possible
- Update TypeScript types accordingly
- Run lint and tests before committing

## Approval

- ✅ User approved design approach
- ✅ User confirmed requirement: show only user workspace for tenant runtime
- ✅ User confirmed fallback: global roots for non-tenant runtime
- ✅ User selected implementation: new `getTenantBrowserRoots()` function