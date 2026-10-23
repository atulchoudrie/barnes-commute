package uk.barnes.commute;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;

/** Refreshes the widget every 15 minutes (Android's shortest repeating job), and once on demand. */
public class RefreshJob extends JobService {
    private static final int PERIODIC = 1, NOW = 2;

    private static JobScheduler jobs(Context c) {
        return (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
    }

    private static JobInfo.Builder job(Context c, int id) {
        return new JobInfo.Builder(id, new ComponentName(c, RefreshJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY);
    }

    static void schedule(Context c) {
        if (jobs(c).getPendingJob(PERIODIC) == null) jobs(c).schedule(job(c, PERIODIC).setPeriodic(15 * 60_000L).build());
    }

    static void runNow(Context c) {
        jobs(c).schedule(job(c, NOW).setOverrideDeadline(5_000L).build());
    }

    static void cancel(Context c) {
        jobs(c).cancel(PERIODIC);
        jobs(c).cancel(NOW);
    }

    @Override
    public boolean onStartJob(JobParameters params) {
        new Thread(() -> {
            Board.refresh(this);
            jobFinished(params, false);
        }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return true; // try again later
    }
}
