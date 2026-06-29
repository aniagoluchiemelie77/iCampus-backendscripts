import {
  Admin,
} from "../tableDeclarations.js";

export const deleteAdmin = async (req, res) => {
  try {
    const { uid } = req.params;
    const requester = req.admin; 
    if (requester.adminType !== 'super_admin') {
      return res.status(403).json({ error: "Only super admins can remove administrators." });
    }
    if (requester.uid === uid) {
      return res.status(400).json({ error: "You cannot remove yourself." });
    }
    const deletedAdmin = await Admin.findOneAndDelete({ uid });

    if (!deletedAdmin) {
      return res.status(404).json({ error: "Admin not found." });
    }

    res.status(200).json({ message: "Admin removed successfully." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
export const createAdmin = async (req, res) => {
  if (req.admin.adminType !== 'super_admin') 
    return res.status(403).json({ error: "Unauthorized" });

  try {
    const newAdmin = new Admin(req.body);
    await newAdmin.save();
    res.status(201).json({ message: "Admin created successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
export const updateAdmin = async (req, res) => {
  if (req.admin.adminType !== 'super_admin') 
    return res.status(403).json({ error: "Unauthorized" });

  try {
    const { uid } = req.params;
    const updated = await Admin.findOneAndUpdate({ uid }, req.body, { new: true });
    res.status(200).json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};