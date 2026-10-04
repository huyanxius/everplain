-- Synthetic fixture: schema only, copied from the authorised reset script.
CREATE TABLE IF NOT EXISTS billing_precision_adjustments (
  reset_id TEXT NOT NULL, user_id TEXT NOT NULL, reason TEXT NOT NULL,
  before_precision TEXT NOT NULL, delta_precision TEXT NOT NULL,
  after_precision TEXT NOT NULL, before_balance INTEGER NOT NULL,
  delta_points INTEGER NOT NULL, after_balance INTEGER NOT NULL,
  closed_operation_ids TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(reset_id,user_id));

CREATE TRIGGER IF NOT EXISTS billing_reset_terminal_fence
            BEFORE UPDATE OF status,credit_pico,charged_points,hold_points ON billing_operations
            WHEN OLD.status IN ('success','error','cancelled','refunded')
              AND EXISTS (SELECT 1 FROM billing_precision_adjustments r,
                          json_each(r.closed_operation_ids) closed
                          WHERE r.user_id=OLD.user_id AND closed.value=OLD.run_id)
              AND (NEW.status!=OLD.status OR NEW.credit_pico!=OLD.credit_pico
                   OR NEW.charged_points!=OLD.charged_points OR NEW.hold_points!=OLD.hold_points)
            BEGIN SELECT RAISE(ROLLBACK, 'billing operation predates account reset'); END;
