// ============================================================================
// LinkBarangay — unauthorized access page
// ============================================================================

import { Icon } from "@/components/common/Icon"
import { Button } from "@/components/common/ui"
import type { ViewId } from "@/types"

export function UnauthorizedPage({ setView }: { setView: (view: ViewId) => void }) {
  return (
    <div className="state-block unauthorized">
      <span className="state-icon">
        <Icon name="shield" />
      </span>
      <strong>You don't have access to that page</strong>
      <p>
        Your account's role and assignment decide which workspace you can open. If you believe
        this is a mistake, contact your barangay administrator.
      </p>
      <div className="state-action">
        <Button icon="home" onClick={() => setView("dashboard")}>
          Back to my dashboard
        </Button>
      </div>
    </div>
  )
}
