import { pool } from "../config/database.js";

export async function audit(req, action, entityType, entityId = null, details = {}) {
    await pool.execute("INSERT INTO audit_logs (admin_user_id,action,entity_type,entity_id,details,ip_address) VALUES (?,?,?,?,?,?)",
        [req.admin?.id || null, action, entityType, entityId == null ? null : String(entityId), JSON.stringify(details), req.ip]);
}
const send = (res, data) => res.json({ success: true, data });
const fail = (res, message, status = 400) => res.status(status).json({ success: false, message });

export async function listCohorts(_req, res, next) {
    try { const [rows] = await pool.execute(`SELECT c.*, p.name AS programmeName, l.name AS lecturerName,
        (SELECT COUNT(*) FROM enrolments e WHERE e.cohort_id=c.id) AS studentCount FROM cohorts c
        JOIN programmes p ON p.id=c.programme_id LEFT JOIN lecturers l ON l.id=c.lecturer_id ORDER BY c.created_at DESC`); send(res, rows); } catch (e) { next(e); }
}
export async function createCohort(req, res, next) {
    const { programmeId, lecturerId, name, code, startDate, endDate } = req.body || {};
    if (!Number.isInteger(Number(programmeId)) || !name?.trim() || !code?.trim()) return fail(res, "Programme, cohort name and code are required.");
    try {
        const [r] = await pool.execute("INSERT INTO cohorts (programme_id,lecturer_id,name,code,start_date,end_date) VALUES (?,?,?,?,?,?)", [programmeId, lecturerId || null, name.trim().slice(0,140), code.trim().slice(0,40), startDate || null, endDate || null]);
        await audit(req,"created","cohort",r.insertId); res.status(201).json({success:true,id:r.insertId});
    } catch(e) { if(e.code==="ER_DUP_ENTRY") return fail(res,"That cohort code is already in use.",409); next(e); }
}
export async function updateCohort(req,res,next) {
    const { programmeId, lecturerId, name, code, startDate, endDate, status } = req.body || {};
    if(!["Planned","Active","Completed","Suspended","Cancelled"].includes(status)) return fail(res,"Choose a valid cohort status.");
    try { const [r]=await pool.execute("UPDATE cohorts SET programme_id=?,lecturer_id=?,name=?,code=?,start_date=?,end_date=?,status=? WHERE id=?",[programmeId,lecturerId||null,String(name||"").trim().slice(0,140),String(code||"").trim().slice(0,40),startDate||null,endDate||null,status,req.params.id]); if(!r.affectedRows)return fail(res,"Cohort not found.",404); await audit(req,"updated","cohort",req.params.id,{status}); send(res,{message:"Cohort updated."}); } catch(e){next(e);}
}

export async function listEnrolments(_req,res,next){
    try {const [rows]=await pool.execute(`SELECT e.id,e.application_id AS applicationId,e.student_id AS studentId,e.programme_id AS programmeId,e.cohort_id AS cohortId,DATE_FORMAT(e.enrolled_at,'%Y-%m-%d') AS enrolledAt,DATE_FORMAT(e.start_date,'%Y-%m-%d') AS startDate,e.status,e.completion_status AS completionStatus,CONCAT(a.first_name,' ',a.last_name) AS studentName,a.email,p.name AS programmeName,c.name AS cohortName,p.fee AS programmeFee,COALESCE(pay.amount_paid,0) AS amountPaid,GREATEST(p.fee-COALESCE(pay.amount_paid,0),0) AS outstandingBalance FROM enrolments e JOIN students s ON s.id=e.student_id JOIN applicants a ON a.id=s.applicant_id JOIN programmes p ON p.id=e.programme_id LEFT JOIN cohorts c ON c.id=e.cohort_id LEFT JOIN (SELECT enrolment_id,SUM(amount) AS amount_paid FROM payments WHERE status='Paid' GROUP BY enrolment_id) pay ON pay.enrolment_id=e.id ORDER BY e.created_at DESC`); send(res,rows);}catch(e){next(e);}
}
export async function enrolAccepted(req,res,next){
    const applicationId=Number(req.params.applicationId); const cohortId=req.body?.cohortId||null;
    const conn=await pool.getConnection();
    try {await conn.beginTransaction(); const [apps]=await conn.execute("SELECT id,applicant_id,programme_id,preferred_start_date,status FROM applications WHERE id=? FOR UPDATE",[applicationId]); if(!apps.length){await conn.rollback();return fail(res,"Application not found.",404);} const app=apps[0]; if(app.status!=="Accepted"){await conn.rollback();return fail(res,"Only accepted applications can be enrolled.",409);} const [paid]=await conn.execute("SELECT COALESCE(SUM(amount),0) AS amountPaid FROM payments WHERE application_id=? AND status='Paid'",[applicationId]); const [fee]=await conn.execute("SELECT fee FROM programmes WHERE id=?",[app.programme_id]); const minimum=Math.ceil(Number(fee[0]?.fee||0)*25-1e-8)/100; if(Number(paid[0]?.amountPaid||0)<minimum){await conn.rollback();return fail(res,"At least 25% of the programme fee must be paid before enrolment.",409);} const [existing]=await conn.execute("SELECT id FROM enrolments WHERE application_id=?",[applicationId]); if(existing.length){await conn.rollback();return fail(res,"This application is already enrolled.",409);} const [ss]=await conn.execute("INSERT INTO students (applicant_id) VALUES (?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)",[app.applicant_id]); const [er]=await conn.execute("INSERT INTO enrolments (student_id,application_id,programme_id,cohort_id,enrolled_at,start_date) VALUES (?,?,?,?,CURRENT_DATE,?)",[ss.insertId,app.id,app.programme_id,cohortId,app.preferred_start_date]); await conn.commit(); await audit(req,"enrolled","enrolment",er.insertId,{applicationId}); res.status(201).json({success:true,id:er.insertId,message:"Student enrolled."}); }
    catch(e){await conn.rollback();next(e);}finally{conn.release();}
}
export async function updateEnrolment(req,res,next){
    const body=req.body||{};
    const {status,completionStatus}=body;
    const cohortId=body.cohortId?Number(body.cohortId):null;
    const dateInput=body.startDate==null||body.startDate===""?null:String(body.startDate);
    const parsedDate=dateInput?new Date(dateInput):null;
    const startDate=!dateInput?null:(/^\d{4}-\d{2}-\d{2}$/.test(dateInput)?dateInput:(parsedDate&&!Number.isNaN(parsedDate.valueOf())?new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Johannesburg",year:"numeric",month:"2-digit",day:"2-digit"}).format(parsedDate):"invalid"));
    const dateIsValid=!startDate||( /^\d{4}-\d{2}-\d{2}$/.test(startDate)&&!Number.isNaN(Date.parse(startDate))&&new Date(startDate+"T00:00:00Z").toISOString().slice(0,10)===startDate);
    if(!["Active","Paused","Completed","Withdrawn"].includes(status)||!["In Progress","Passed","Failed","Not Completed"].includes(completionStatus)||!dateIsValid|| (cohortId!==null&&!Number.isSafeInteger(cohortId)))return fail(res,"Choose valid enrolment, completion, date and cohort values.");
    try{
        const [enrolments]=await pool.execute("SELECT programme_id AS programmeId FROM enrolments WHERE id=? LIMIT 1",[req.params.id]);
        if(!enrolments.length)return fail(res,"Enrolment not found.",404);
        if(cohortId!==null){
            const [cohorts]=await pool.execute("SELECT id FROM cohorts WHERE id=? AND programme_id=? LIMIT 1",[cohortId,enrolments[0].programmeId]);
            if(!cohorts.length)return fail(res,"Choose a cohort assigned to this student's programme.",400);
        }
        await pool.execute("UPDATE enrolments SET cohort_id=?,status=?,completion_status=?,start_date=? WHERE id=?",[cohortId,status,completionStatus,startDate,req.params.id]);
        await audit(req,"updated","enrolment",req.params.id,{status,completionStatus,cohortId});
        send(res,{message:"Student enrolment updated."});
    }catch(e){next(e);}
}

export async function academicData(req,res,next){
    const type=req.params.type; const queries={modules:"SELECT m.id,m.name,m.description,m.sequence_no AS sequenceNo,p.name AS programmeName,m.programme_id AS programmeId FROM modules m JOIN programmes p ON p.id=m.programme_id ORDER BY p.name,m.sequence_no",lessons:"SELECT l.id,l.title,l.content,l.lesson_order AS lessonOrder,m.name AS moduleName FROM lessons l JOIN modules m ON m.id=l.module_id ORDER BY m.name,l.lesson_order",assessments:"SELECT a.id,a.kind,a.title,a.instructions,a.due_date AS dueDate,a.max_score AS maxScore,m.name AS moduleName FROM assessments a JOIN modules m ON m.id=a.module_id ORDER BY a.due_date",attendance:"SELECT at.id,at.class_date AS classDate,at.status,at.notes,CONCAT(ap.first_name,' ',ap.last_name) AS studentName,p.name AS programmeName FROM attendance at JOIN enrolments e ON e.id=at.enrolment_id JOIN students s ON s.id=e.student_id JOIN applicants ap ON ap.id=s.applicant_id JOIN programmes p ON p.id=e.programme_id ORDER BY at.class_date DESC LIMIT 500",results:"SELECT r.id,a.title AS assessment,CONCAT(ap.first_name,' ',ap.last_name) AS studentName,p.name AS programmeName,r.score,a.max_score AS maxScore,r.feedback,r.graded_at AS gradedAt FROM results r JOIN assessments a ON a.id=r.assessment_id JOIN enrolments e ON e.id=r.enrolment_id JOIN students s ON s.id=e.student_id JOIN applicants ap ON ap.id=s.applicant_id JOIN programmes p ON p.id=e.programme_id ORDER BY r.graded_at DESC",progress:"SELECT mp.id,CONCAT(ap.first_name,' ',ap.last_name) AS studentName,m.name AS moduleName,mp.progress_percent AS progressPercent,mp.status,mp.updated_at AS updatedAt FROM student_module_progress mp JOIN enrolments e ON e.id=mp.enrolment_id JOIN students s ON s.id=e.student_id JOIN applicants ap ON ap.id=s.applicant_id JOIN modules m ON m.id=mp.module_id ORDER BY mp.updated_at DESC"};
    if(!queries[type])return fail(res,"Unknown academic record type.",404); try{const[rows]=await pool.execute(queries[type]);send(res,rows);}catch(e){next(e);}
}
export async function saveAcademic(req,res,next){
    const {type}=req.params;const b=req.body||{};let sql,values,entity=type;
    if(type==="modules"){if(!b.programmeId||!b.name?.trim())return fail(res,"Programme and module name are required.");sql="INSERT INTO modules (programme_id,name,description,sequence_no) VALUES (?,?,?,?)";values=[b.programmeId,b.name.trim().slice(0,160),b.description||null,Number(b.sequenceNo)||1];}
    else if(type==="lessons"){if(!b.moduleId||!b.title?.trim())return fail(res,"Module and lesson title are required.");sql="INSERT INTO lessons (module_id,title,content,lesson_order) VALUES (?,?,?,?)";values=[b.moduleId,b.title.trim().slice(0,180),b.content||null,Number(b.lessonOrder)||1];}
    else if(type==="assessments"){if(!b.moduleId||!b.title?.trim()||!['Assignment','Quiz','Assessment'].includes(b.kind))return fail(res,"Module, title and assessment type are required.");sql="INSERT INTO assessments (module_id,kind,title,instructions,due_date,max_score) VALUES (?,?,?,?,?,?)";values=[b.moduleId,b.kind,b.title.trim().slice(0,180),b.instructions||null,b.dueDate||null,Number(b.maxScore)||100];}
    else if(type==="attendance"){if(!b.enrolmentId||!b.classDate||!['Present','Absent','Late','Excused'].includes(b.status))return fail(res,"Enrolment, date and attendance status are required.");sql="INSERT INTO attendance (enrolment_id,class_date,status,notes,recorded_by) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE status=VALUES(status),notes=VALUES(notes)";values=[b.enrolmentId,b.classDate,b.status,b.notes||null,req.admin.id];}
    else if(type==="results"){if(!b.assessmentId||!b.enrolmentId||!Number.isFinite(Number(b.score))||Number(b.score)<0)return fail(res,"Assessment, enrolment and valid score are required.");sql="INSERT INTO results (assessment_id,enrolment_id,score,feedback,graded_by) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE score=VALUES(score),feedback=VALUES(feedback),graded_by=VALUES(graded_by),graded_at=CURRENT_TIMESTAMP";values=[b.assessmentId,b.enrolmentId,b.score,b.feedback||null,req.admin.id];}
    else if(type==="progress"){if(!b.enrolmentId||!b.moduleId||Number(b.progressPercent)<0||Number(b.progressPercent)>100)return fail(res,"Enrolment, module and progress from 0 to 100 are required.");const p=Number(b.progressPercent);sql="INSERT INTO student_module_progress (enrolment_id,module_id,progress_percent,status) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE progress_percent=VALUES(progress_percent),status=VALUES(status)";values=[b.enrolmentId,b.moduleId,p,p===100?'Completed':p>0?'In Progress':'Not Started'];}
    else return fail(res,"Unknown academic record type.",404);
    try{const[r]=await pool.execute(sql,values);await audit(req,"created",entity,r.insertId);res.status(201).json({success:true,id:r.insertId||null});}catch(e){next(e);}
}

export async function reports(req,res,next){
    const queries={applications:"SELECT status,COUNT(*) AS total FROM applications GROUP BY status",students:"SELECT status,COUNT(*) AS total FROM students GROUP BY status",enrolments:"SELECT status,completion_status AS completionStatus,COUNT(*) AS total FROM enrolments GROUP BY status,completion_status",payments:"SELECT status,COUNT(*) AS transactions,COALESCE(SUM(amount),0) AS amount FROM payments GROUP BY status",attendance:"SELECT status,COUNT(*) AS total FROM attendance GROUP BY status",results:"SELECT COUNT(*) AS assessments,AVG(score) AS averageScore FROM results",certificates:"SELECT status,COUNT(*) AS total FROM certificates GROUP BY status"};
    if(!queries[req.params.type])return fail(res,"Unknown report type.",404);try{const[rows]=await pool.execute(queries[req.params.type]);send(res,rows);}catch(e){next(e);}
}
export async function listAnnouncements(_req,res,next){try{const[rows]=await pool.execute("SELECT a.id,a.title,a.body,a.audience,a.status,a.published_at AS publishedAt,a.created_at AS createdAt,u.name AS createdBy FROM announcements a LEFT JOIN admin_users u ON u.id=a.created_by ORDER BY a.created_at DESC");send(res,rows);}catch(e){next(e);}}
export async function createAnnouncement(req,res,next){const{title,body,audience="Everyone",status="Draft"}=req.body||{};if(!title?.trim()||!body?.trim()||!['Students','Staff','Everyone'].includes(audience)||!['Draft','Published','Archived'].includes(status))return fail(res,"Provide a title, message, audience and status.");try{const[r]=await pool.execute("INSERT INTO announcements (title,body,audience,status,published_at,created_by) VALUES (?,?,?,?,IF(?='Published',CURRENT_TIMESTAMP,NULL),?)",[title.trim().slice(0,180),body.trim(),audience,status,status,req.admin.id]);await audit(req,"created","announcement",r.insertId);res.status(201).json({success:true,id:r.insertId});}catch(e){next(e);}}
export async function getSettings(_req,res,next){try{const[rows]=await pool.execute("SELECT setting_key AS `key`,setting_value AS value FROM academy_settings ORDER BY setting_key");send(res,rows);}catch(e){next(e);}}
export async function saveSettings(req,res,next){const values=req.body?.settings;if(!values||typeof values!=="object"||Array.isArray(values))return fail(res,"Settings object is required.");try{for(const[key,value]of Object.entries(values)){if(!/^[a-z][a-z0-9_]{1,99}$/i.test(key)||typeof value!=="string")continue;await pool.execute("INSERT INTO academy_settings (setting_key,setting_value,updated_by) VALUES (?,?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value),updated_by=VALUES(updated_by)",[key,value.slice(0,2000),req.admin.id]);}await audit(req,"updated","settings",null,{keys:Object.keys(values)});send(res,{message:"Settings saved."});}catch(e){next(e);}}
export async function listAudit(_req,res,next){try{const[rows]=await pool.execute("SELECT l.id,l.action,l.entity_type AS entityType,l.entity_id AS entityId,l.details,l.ip_address AS ipAddress,l.created_at AS createdAt,u.name AS administrator FROM audit_logs l LEFT JOIN admin_users u ON u.id=l.admin_user_id ORDER BY l.created_at DESC LIMIT 500");send(res,rows);}catch(e){next(e);}}
