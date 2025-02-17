import * as chrono from 'chrono-node';
import { Task, TaskCopy } from './task.model';
import { getWorklogStr } from '../../util/get-work-log-str';
import { stringToMs } from '../../ui/duration/string-to-ms.pipe';
import { Tag } from '../tag/tag.model';
import { Project } from '../project/project.model';

export const SHORT_SYNTAX_TIME_REG_EX =
  / t?(([0-9]+(m|h|d)+)? *\/ *)?([0-9]+(m|h|d)+) *$/i;
// NOTE: should come after the time reg ex is executed so we don't have to deal with those strings too

const CH_PRO = '+';
const CH_TAG = '#';
const CH_DUE = '@';
const ALL_SPECIAL = `(\\${CH_PRO}|\\${CH_TAG}|\\${CH_DUE})`;

const customDateParser = chrono.casual.clone();
customDateParser.parsers.push(
  {
    // match tomorrow
    pattern: () => /^tom| @tom/i,
    extract: () => {
      const today = new Date();
      return {
        day: today.getDate() + 1,
      };
    },
  },
  {
    // match today
    pattern: () => /^tod| @tod/i,
    extract: () => {
      const today = new Date();
      return {
        day: today.getDate(),
      };
    },
  },
);

export const SHORT_SYNTAX_PROJECT_REG_EX = new RegExp(
  `\\${CH_PRO}[^${ALL_SPECIAL}]+`,
  'gi',
);
export const SHORT_SYNTAX_TAGS_REG_EX = new RegExp(`\\${CH_TAG}[^${ALL_SPECIAL}]+`, 'gi');

// Literal notation: /\@[^\+|\#|\@]/gi
// Match string starting with the literal @ and followed by 1 or more of the characters
// not in the ALL_SPECIAL
export const SHORT_SYNTAX_DUE_REG_EX = new RegExp(`\\${CH_DUE}[^${ALL_SPECIAL}]+`, 'gi');

export const shortSyntax = (
  task: Task | Partial<Task>,
  allTags?: Tag[],
  allProjects?: Project[],
):
  | {
      taskChanges: Partial<Task>;
      newTagTitles: string[];
      remindAt: number | null;
      projectId: string | undefined;
    }
  | undefined => {
  if (!task.title) {
    return;
  }
  if (typeof (task.title as any) !== 'string') {
    throw new Error('No str');
  }

  // TODO clean up this mess
  let taskChanges: Partial<TaskCopy>;

  // NOTE: we do this twice... :-O ...it's weird, but required to make whitespaces work as separator and not as one
  taskChanges = parseTimeSpentChanges(task);
  const changesForScheduledDate = parseScheduledDate(task);
  taskChanges = {
    ...taskChanges,
    ...changesForScheduledDate,
  };
  const changesForProject = parseProjectChanges(
    { ...task, title: taskChanges.title || task.title },
    allProjects,
  );
  if (changesForProject.projectId) {
    taskChanges = {
      ...taskChanges,
      title: changesForProject.title,
    };
  }

  const changesForTag = parseTagChanges(
    { ...task, title: taskChanges.title || task.title },
    allTags,
  );
  taskChanges = {
    ...taskChanges,
    ...changesForTag.taskChanges,
  };
  taskChanges = {
    ...taskChanges,
    // NOTE: because we pass the new taskChanges here we need to assignments...
    ...parseTimeSpentChanges(taskChanges),
  };

  // const changesForDue = parseDueChanges({...task, title: taskChanges.title || task.title});
  // if (changesForDue.remindAt) {
  //   taskChanges = {
  //     ...taskChanges,
  //     title: changesForDue.title,
  //   };
  // }

  if (Object.keys(taskChanges).length === 0) {
    return undefined;
  }

  return {
    taskChanges,
    newTagTitles: changesForTag.newTagTitlesToCreate,
    remindAt: null,
    projectId: changesForProject.projectId,
    // remindAt: changesForDue.remindAt
  };
};

const parseProjectChanges = (
  task: Partial<TaskCopy>,
  allProjects?: Project[],
): {
  title?: string;
  projectId?: string;
} => {
  // don't allow for issue tasks
  if (task.issueId) {
    return {};
  }
  if (!Array.isArray(allProjects) || !allProjects || allProjects.length === 0) {
    return {};
  }
  if (!task.title) {
    return {};
  }

  const rr = task.title.match(SHORT_SYNTAX_PROJECT_REG_EX);

  if (rr && rr[0]) {
    const projectTitle: string = rr[0].trim().replace(CH_PRO, '');
    const projectTitleToMatch = projectTitle.replace(' ', '').toLowerCase();
    const existingProject = allProjects.find(
      (project) =>
        project.title.replace(' ', '').toLowerCase().indexOf(projectTitleToMatch) === 0,
    );

    if (existingProject) {
      return {
        title: task.title?.replace(`${CH_PRO}${projectTitle}`, '').trim(),
        projectId: existingProject.id,
      };
    }

    // also try only first word after special char
    const projectTitleFirstWordOnly = projectTitle.split(' ')[0];
    const projectTitleToMatch2 = projectTitleFirstWordOnly.replace(' ', '').toLowerCase();
    const existingProjectForFirstWordOnly = allProjects.find(
      (project) =>
        project.title.replace(' ', '').toLowerCase().indexOf(projectTitleToMatch2) === 0,
    );

    if (existingProjectForFirstWordOnly) {
      return {
        title: task.title
          ?.replace(`${CH_PRO}${projectTitleFirstWordOnly}`, '')
          .trim()
          // get rid of excess whitespaces
          .replace('  ', ' '),
        projectId: existingProjectForFirstWordOnly.id,
      };
    }
  }

  return {};
};

const parseTagChanges = (
  task: Partial<TaskCopy>,
  allTags?: Tag[],
): { taskChanges: Partial<TaskCopy>; newTagTitlesToCreate: string[] } => {
  const taskChanges: Partial<TaskCopy> = {};

  if (task.parentId) {
    return { taskChanges, newTagTitlesToCreate: [] };
  }

  const newTagTitlesToCreate: string[] = [];
  // only exec if previous ones are also passed
  if (Array.isArray(task.tagIds) && Array.isArray(allTags)) {
    const initialTitle = task.title as string;
    const regexTagTitles = initialTitle.match(SHORT_SYNTAX_TAGS_REG_EX);
    if (regexTagTitles && regexTagTitles.length) {
      const regexTagTitlesTrimmedAndFiltered: string[] = regexTagTitles
        .map((title) => title.trim().replace(CH_TAG, ''))
        .filter(
          (newTagTitle) =>
            newTagTitle.length >= 1 &&
            // NOTE: we check this to not trigger for "#123 blasfs dfasdf"
            initialTitle.trim().lastIndexOf(newTagTitle) > 4,
        );

      const tagIdsToAdd: string[] = [];
      regexTagTitlesTrimmedAndFiltered.forEach((newTagTitle) => {
        const existingTag = allTags.find(
          (tag) => newTagTitle.toLowerCase() === tag.title.toLowerCase(),
        );
        if (existingTag) {
          if (!task.tagIds?.includes(existingTag.id)) {
            tagIdsToAdd.push(existingTag.id);
          }
        } else {
          newTagTitlesToCreate.push(newTagTitle);
        }
      });

      if (tagIdsToAdd.length) {
        taskChanges.tagIds = [...(task.tagIds as string[]), ...tagIdsToAdd];
      }

      if (newTagTitlesToCreate.length || tagIdsToAdd.length) {
        taskChanges.title = initialTitle;
        regexTagTitlesTrimmedAndFiltered.forEach((tagTitle) => {
          taskChanges.title = taskChanges.title?.replace(`#${tagTitle}`, '');
        });
        taskChanges.title = taskChanges.title.trim();
      }

      // console.log(task.title);
      // console.log('newTagTitles', regexTagTitles);
      // console.log('newTagTitlesTrimmed', regexTagTitlesTrimmedAndFiltered);
      // console.log('allTags)', allTags.map(tag => `${tag.id}: ${tag.title}`));
      // console.log('task.tagIds', task.tagIds);
      // console.log('task.title', task.title);
    }
  }
  // console.log(taskChanges);

  return {
    taskChanges,
    newTagTitlesToCreate,
  };
};

const parseScheduledDate = (task: Partial<TaskCopy>): Partial<Task> => {
  if (!task.title) {
    return {};
  }
  const rr = task.title.match(SHORT_SYNTAX_DUE_REG_EX);
  if (rr && rr[0]) {
    const now = new Date();
    const parsedDateArr = customDateParser.parse(task.title, new Date(), {
      forwardDate: true,
    });
    if (parsedDateArr.length) {
      const parsedDateResult = parsedDateArr[0];
      console.log({ parsedDateResult });
      const start = parsedDateResult.start;
      let plannedAt = start.date().getTime();
      // If user doesn't explicitly enter time, set the scheduled date
      // to 23:59:59 of the given day
      if (!start.isCertain('hour')) {
        plannedAt = start.date().setHours(23, 59, 59);
      } else if (start.date().getTime() < now.getTime()) {
        plannedAt = start.date().setDate(start.date().getDate() + 1);
      }
      const inputDate = parsedDateResult.text;
      return {
        plannedAt,
        // Strip out the short syntax for scheduled date and given date
        title: task.title.replace(`@${inputDate}`, ''),
      };
    }
  }
  return {};
};

const parseTimeSpentChanges = (task: Partial<TaskCopy>): Partial<Task> => {
  if (!task.title) {
    return {};
  }

  const matches = SHORT_SYNTAX_TIME_REG_EX.exec(task.title);

  if (matches && matches.length >= 3) {
    const full = matches[0];
    const timeSpent = matches[2];
    const timeEstimate = matches[4];

    return {
      ...(timeSpent
        ? {
            timeSpentOnDay: {
              ...(task.timeSpentOnDay || {}),
              [getWorklogStr()]: stringToMs(timeSpent),
            },
          }
        : {}),
      timeEstimate: stringToMs(timeEstimate),
      title: task.title.replace(full, ''),
    };
  }

  return {};
};

// const parseDueChanges = (task: Partial<TaskCopy>): {
//   title?: string;
//   remindAt?: number;
// } => {
//   if (!task.title) {
//     return {};
//   }
//
//   const matches = SHORT_SYNTAX_DUE_REG_EX.exec(task.title);
//   console.log(matches);
//
//   if (matches && matches[0]) {
//     const dateStr = matches[0].replace(CH_DUE, '');
//     console.log(dateStr);
//     const m = moment(dateStr);
//     if (m.isValid()) {
//       const title = task.title.replace(matches[0], '');
//       console.log(m);
//       console.log(title);
//     } else {
//       // TODO parse clock string here
//     }
//   }
//   return {};
// };
