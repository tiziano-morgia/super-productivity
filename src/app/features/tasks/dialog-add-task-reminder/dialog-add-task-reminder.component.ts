import {ChangeDetectionStrategy, Component, Inject} from '@angular/core';
import {MAT_DIALOG_DATA, MatDialogRef} from '@angular/material/dialog';
import {TaskService} from '../task.service';
import {ReminderCopy} from '../../reminder/reminder.model';
import {ReminderService} from '../../reminder/reminder.service';
import {SnackService} from '../../../core/snack/snack.service';
import {T} from '../../../t.const';
import {AddTaskReminderInterface} from './add-task-reminder-interface';

@Component({
  selector: 'dialog-add-task-reminder',
  templateUrl: './dialog-add-task-reminder.component.html',
  styleUrls: ['./dialog-add-task-reminder.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DialogAddTaskReminderComponent {
  T = T;
  title: string = this.data.title;
  reminder: ReminderCopy = this.data.reminderId && this._reminderService.getById(this.data.reminderId);
  isEdit: boolean = !!(this.reminder && this.reminder.id);
  dateTime: number = this.reminder && this.reminder.remindAt;
  isMoveToBacklogPossible: boolean = (!this.isEdit && this.data.isMoveToBacklogPossible);
  isMoveToBacklog: boolean = (this.isMoveToBacklogPossible);

  constructor(
    private _taskService: TaskService,
    private _snackService: SnackService,
    private _reminderService: ReminderService,
    private _matDialogRef: MatDialogRef<DialogAddTaskReminderComponent>,
    @Inject(MAT_DIALOG_DATA) public data: AddTaskReminderInterface,
  ) {
  }

  save() {
    const timestamp = this.dateTime;

    if (!timestamp || !this.title) {
      return;
    }

    if (this.isEdit) {
      this._taskService.updateReminder(
        this.data.taskId,
        this.reminder.id,
        timestamp,
        this.title,
      );
      this.close();
    } else {
      this._taskService.addReminder(
        this.data.taskId,
        timestamp,
        this.title,
        this.isMoveToBacklog,
      );
      this.close();
    }
  }

  remove() {
    this._taskService.removeReminder(this.data.taskId, this.reminder.id);
    this.close();
  }

  close() {
    this._matDialogRef.close();
  }
}
